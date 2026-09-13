require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Options } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const Database = require('croxydb');

// Veritabanını ortak ve sabit bir dosyaya sabitliyoruz (Verilerin kaybolmasını ve senkron sorununu önler)
const db = new Database({
    databasePath: path.join(__dirname, 'database.json')
});

const app = express();
const PORT = process.env.PORT || 10000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages
    ],
    makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        PresenceManager: Infinity,
    })
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

// Doğrudan Puan Formatı (10 saniyede 1 puan)
function formatPoint(puan) {
    return `${puan || 0} Puan`;
}

// Puan Ekleme Fonksiyonu
function addPointToUser(member) {
    if (!member || !member.user) return;

    const key = `stats_${member.id}`;
    let userData = db.get(key) || {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName || member.user.globalName || member.user.username,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
        total: 0
    };

    userData.username = member.user.username;
    userData.displayName = member.displayName || member.user.globalName || member.user.username;
    userData.avatar = member.user.displayAvatarURL({ extension: 'png', size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
    userData.total = (userData.total || 0) + 1;

    db.set(key, userData);
    console.log(`[VERİTABANINA YAZILDI] ${userData.displayName} | Toplam Puan: ${userData.total}`);
}

// Web Paneli Rotası
app.get('/', async (req, res) => {
    try {
        let rawData = db.all();
        let allData = [];

        if (Array.isArray(rawData)) {
            allData = rawData.map(item => ({ ID: item.ID || item.key, data: item.data || item.value }));
        } else if (rawData && typeof rawData === 'object') {
            allData = Object.entries(rawData).map(([ID, val]) => ({ ID, data: typeof val === 'object' ? (val.data || val.value) : val }));
        }

        const activeRecords = allData
            .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('stats_'))
            .map(item => {
                const uData = item.data || {};
                const totalPoints = uData.total || 0;
                const formattedPoint = formatPoint(totalPoints);

                return {
                    userId: uData.id || item.ID.replace('stats_', ''),
                    username: uData.username || 'Oyuncu',
                    displayName: uData.displayName || uData.username || 'Oyuncu',
                    avatar: uData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
                    dailyStr: formattedPoint,
                    weeklyStr: formattedPoint,
                    monthlyStr: formattedPoint,
                    totalStr: formattedPoint,
                    rawTotal: totalPoints
                };
            })
            .sort((a, b) => b.rawTotal - a.rawTotal);

        res.render('index', { 
            bot: client.user ? { username: client.user.username } : null, 
            records: activeRecords, 
            stats: { guilds: client.guilds.cache.size, activeCount: activeRecords.length } 
        });
    } catch (e) {
        console.error("Web panel hata:", e);
        res.render('index', { bot: null, records: [], stats: { guilds: 0, activeCount: 0 } });
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
                .setDescription('Sunucudaki Counter aktifliği ve puan liderlik tablosunu görüntülersiniz.')
                .toJSON()
        ];

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[BAŞARILI] /aktiflikbot komutu yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }

    // HER 10 SANİYEDE BİR: İsmi "counter" geçen oyunları oynayanlara 1 puan ekle
    setInterval(async () => {
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            if (!guild) return;

            await guild.members.fetch({ withPresences: true }).catch(() => {});

            guild.members.cache.forEach(member => {
                if (!member.presence || !member.presence.activities) return;

                const isPlayingCounter = member.presence.activities.some(act => {
                    if (!act || act.type !== 0) return false; // Tür 0: Oynuyor
                    const gameName = act.name.toLowerCase();
                    return gameName.includes('counter');
                });
                
                if (isPlayingCounter) {
                    addPointToUser(member);
                }
            });
        } catch (err) {
            console.error("Periyodik tarama hatası:", err);
        }
    }, 10000);
});

// Slash Komutu (/aktiflikbot -> Liderlik Tablosu)
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'aktiflikbot') {
            await interaction.deferReply().catch(() => {});

            let rawData = db.all();
            let allData = [];

            if (Array.isArray(rawData)) {
                allData = rawData.map(item => ({ ID: item.ID || item.key, data: item.data || item.value }));
            } else if (rawData && typeof rawData === 'object') {
                allData = Object.entries(rawData).map(([ID, val]) => ({ ID, data: typeof val === 'object' ? (val.data || val.value) : val }));
            }

            const leaderboard = allData
                .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('stats_'))
                .map(item => {
                    const uData = item.data || {};
                    return {
                        userId: uData.id || item.ID.replace('stats_', ''),
                        displayName: uData.displayName || uData.username || 'Oyuncu',
                        total: uData.total || 0
                    };
                })
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor('#0ea5e9')
                .setTitle('🏆 Letra XII - Counter Puan Sıralaması')
                .setDescription('Sunucudaki en yüksek puanlı Counter oyuncuları:')
                .setTimestamp();

            if (leaderboard.length === 0) {
                embed.addFields({ name: 'Durum', value: 'Henüz kaydedilmiş bir Counter puanı bulunmuyor.' });
            } else {
                let finalDesc = '';
                leaderboard.forEach((item, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
                    finalDesc += `${medal} <@${item.userId}> — **${formatPoint(item.total)}**\n`;
                });
                embed.addFields({ name: 'Sıralama', value: finalDesc });
            }

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {
        console.error("Interaction hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda.`));
client.login(process.env.TOKEN);
