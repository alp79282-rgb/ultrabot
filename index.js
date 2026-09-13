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

// BURAYA EKİP ROLÜNÜN ID'SİNİ YAZACAKSIN
const EKIP_ROL_ID = 'BURAYA_EKIP_ROL_ID_Gelecek'; 

app.get('/', async (req, res) => {
    try {
        let rawData = db.all();
        let allData = Array.isArray(rawData) ? rawData : [];
        const activeRecords = allData
            .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('aktiflik_'))
            .map(item => ({ userId: item.ID.replace('aktiflik_', ''), time: item.data }));
        
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
    const GUILD_ID = '1530348723958321262';
    const CLIENT_ID = process.env.CLIENT_ID;

    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('aktiflikistatistik')
                .setDescription('Letra XII sunucu geneli ekip aktiflik sıralamasını gösterir.')
                .toJSON()
        ];

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[BAŞARILI] /aktiflikistatistik komutu sunucuya yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }
});

// Sadece belirtilen EKİP ROLÜNE sahip olanları takip eden presenceUpdate
client.on('presenceUpdate', async (oldPresence, newPresence) => {
    try {
        if (!newPresence || !newPresence.member) return;
        
        // Ekip rolü kontrolü (Eğer rolü yoksa direkt yoksay / hiçe say)
        if (EKIP_ROL_ID !== 'BURAYA_EKIP_ROL_ID_Gelecek' && !newPresence.member.roles.cache.has(EKIP_ROL_ID)) {
            return; 
        }

        const userId = newPresence.member.id;
        const playingLetra = newPresence.activities.find(act => act.name && act.name.toLowerCase().includes('letra xii'));

        if (playingLetra) {
            let currentCount = 0;
            try { currentCount = db.get(`aktiflik_${userId}`) || 0; } catch(e){}
            try { db.set(`aktiflik_${userId}`, currentCount + 1); } catch(e){}
        }
    } catch (err) {}
});

client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'aktiflikistatistik') {
            await interaction.deferReply().catch(() => {});

            let rawData = db.all();
            let allData = Array.isArray(rawData) ? rawData : [];
            
            const leaderboard = allData
                .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('aktiflik_'))
                .map(item => ({
                    userId: item.ID.replace('aktiflik_', ''),
                    score: item.data || 0
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor('#0ea5e9')
                .setTitle('🏆 Letra XII - Ekip Aktiflik Sıralaması')
                .setTimestamp();

            if (leaderboard.length === 0) {
                embed.setDescription('Henüz kaydedilmiş bir aktiflik verisi bulunmuyor.');
            } else {
                let description = '';
                leaderboard.forEach((item, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
                    description += `${medal} <@${item.userId}> — **${item.score}** Puan\n`;
                });
                embed.setDescription(description);
            }

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {
        console.error("Interaction genel hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda.`));
client.login(process.env.TOKEN);
