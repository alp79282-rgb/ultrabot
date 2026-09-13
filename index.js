require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('croxydb');

const app = express();
const PORT = process.env.PORT || 10000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages
    ]
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'letra-xii-secret-key-987654',
    resave: false,
    saveUninitialized: false
}));

const GUILD_ID = '1530348723958321262';

// Web Paneli
app.get('/', async (req, res) => {
    try {
        let rawData = db.all();
        let allData = Array.isArray(rawData) ? rawData : [];
        
        const activeRecords = allData
            .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('aktiflik_'))
            .map(item => {
                const userId = item.ID.replace('aktiflik_', '');
                const puan = item.data || 0;
                
                const toplamSaniye = puan * 10;
                const saat = Math.floor(toplamSaniye / 3600);
                const dakika = Math.floor((toplamSaniye % 3600) / 60);

                let sureStr = '';
                if (saat > 0) sureStr += `${saat} Saat `;
                sureStr += `${dakika} Dakika`;

                return { userId, time: sureStr, rawScore: puan };
            });
        
        res.render('index', { 
            bot: client.user ? { username: client.user.username } : null, 
            records: activeRecords, 
            stats: { guilds: client.guilds.cache.size, users: 0, activeCount: activeRecords.length } 
        });
    } catch (e) {
        res.render('index', { bot: null, records: [], stats: { guilds: 0, users: 0, activeCount: 0 } });
    }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

client.once('ready', async () => {
    console.log(`[🚀 BOT AKTİF] ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const CLIENT_ID = process.env.CLIENT_ID;

    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('aktiflikbot')
                .setDescription('Kişisel Letra XII oyun sürenizi ve aktiflik durumunuzu görüntülersiniz.')
                .toJSON()
        ];

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[BAŞARILI] /aktiflikbot komutu yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }

    // ARKA PLAN TARAMASI (Her 10 saniyede bir doğrudan API ile üyeleri ve oyunları çeker)
    setInterval(async () => {
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            if (!guild) {
                console.log("[HATA] Hedef sunucu (Guild) bulunamadı! ID'yi kontrol edin.");
                return;
            }

            // Üyeleri ve presenceları doğrudan Discord sunucusundan zorla tazele
            const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
            if (!members) return;

            members.forEach(member => {
                if (!member.presence || !member.presence.activities) return;

                member.presence.activities.forEach(act => {
                    if (act && act.name) {
                        const name = act.name.toLowerCase();
                        // Counter-Strike, CS veya Letra kelimelerini esnek bir şekilde yakalar
                        if (name.includes('counter') || name.includes('cs') || name.includes('letra')) {
                            let currentCount = 0;
                            try { currentCount = db.get(`aktiflik_${member.id}`) || 0; } catch(e){}
                            db.set(`aktiflik_${member.id}`, currentCount + 1);
                            console.log(`[OYUN YAKALANDI] Kullanıcı: ${member.user.tag} | Oyun: ${act.name} | Toplam Puan: ${currentCount + 1}`);
                        }
                    }
                });
            });
        } catch (err) {
            console.error("Periyodik tarama hatası:", err);
        }
    }, 10000);
});

// Komut yönetimi (/aktiflikbot)
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'aktiflikbot') {
            await interaction.deferReply().catch(() => {});

            let rawData = db.all();
            let allData = Array.isArray(rawData) ? rawData : [];
            
            const leaderboard = allData
                .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('aktiflik_'))
                .map(item => {
                    const userId = item.ID.replace('aktiflik_', '');
                    const puan = item.data || 0;
                    const toplamSaniye = puan * 10;
                    const saat = Math.floor(toplamSaniye / 3600);
                    const dakika = Math.floor((toplamSaniye % 3600) / 60);

                    let sureStr = '';
                    if (saat > 0) sureStr += `${saat} Saat `;
                    sureStr += `${dakika} Dakika`;

                    return { userId, scoreStr: sureStr, raw: puan };
                })
                .sort((a, b) => b.raw - a.raw)
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor('#0ea5e9')
                .setTitle('🏆 Letra XII - Aktiflik Sıralaması')
                .setTimestamp();

            if (leaderboard.length === 0) {
                embed.setDescription('Henüz kaydedilmiş bir aktiflik verisi bulunmuyor.');
            } else {
                let description = '';
                leaderboard.forEach((item, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
                    description += `${medal} <@${item.userId}> — **${item.scoreStr}**\n`;
                });
                embed.setDescription(description);
            }

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {
        console.error("Interaction hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda.`));
client.login(process.env.TOKEN);
