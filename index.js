require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Options } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

const DB_FILE = path.join(__dirname, 'database.json');

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({}));
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error("Veritabanı yazma hatası:", e);
    }
}

function updateResetFields(userData) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = todayStr.slice(0, 7);
    
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekStr = `${now.getFullYear()}-W${Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7)}`;

    if (!userData.lastDaily || userData.lastDaily !== todayStr) {
        userData.daily = 0;
        userData.lastDaily = todayStr;
    }
    if (!userData.lastWeekly || userData.lastWeekly !== weekStr) {
        userData.weekly = 0;
        userData.lastWeekly = weekStr;
    }
    if (!userData.lastMonthly || userData.lastMonthly !== monthStr) {
        userData.monthly = 0;
        userData.lastMonthly = monthStr;
    }
}

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
    secret: 'ventra-secret-key-987654',
    resave: false,
    saveUninitialized: false
}));

const GUILD_ID = '1530348723958321262';

function formatPoint(puan) {
    return `${puan || 0} Puan`;
}

function addPointToUser(member) {
    if (!member || !member.user) return;

    let db = readDB();
    const key = `stats_${member.id}`;
    
    let userData = db[key] || {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName || member.user.globalName || member.user.username,
        avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
        daily: 0,
        weekly: 0,
        monthly: 0,
        total: 0,
        lastDaily: '',
        lastWeekly: '',
        lastMonthly: ''
    };

    updateResetFields(userData);

    userData.username = member.user.username;
    userData.displayName = member.displayName || member.user.globalName || member.user.username;
    userData.avatar = member.user.displayAvatarURL({ extension: 'png', size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
    
    userData.daily = (userData.daily || 0) + 1;
    userData.weekly = (userData.weekly || 0) + 1;
    userData.monthly = (userData.monthly || 0) + 1;
    userData.total = (userData.total || 0) + 1;

    db[key] = userData;
    writeDB(db);
}

app.get('/', async (req, res) => {
    try {
        let db = readDB();
        const activeRecords = Object.keys(db)
            .filter(key => key.startsWith('stats_'))
            .map(key => {
                const uData = db[key] || {};
                updateResetFields(uData);

                return {
                    userId: uData.id || key.replace('stats_', ''),
                    username: uData.username || 'Oyuncu',
                    displayName: uData.displayName || uData.username || 'Oyuncu',
                    avatar: uData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
                    dailyStr: formatPoint(uData.daily),
                    weeklyStr: formatPoint(uData.weekly),
                    monthlyStr: formatPoint(uData.monthly),
                    totalStr: formatPoint(uData.total),
                    rawTotal: uData.total || 0
                };
            })
            .sort((a, b) => b.rawTotal - a.rawTotal);

        res.render('index', { 
            bot: client.user ? { username: client.user.username } : null, 
            records: activeRecords, 
            stats: { guilds: client.guilds.cache.size, activeCount: activeRecords.length } 
        });
    } catch (e) {
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
                .setName('aktiflik')
                .setDescription('Letra sunucusundaki kendi aktiflik ve puan istatistiklerinizi görürsünüz.'),
            new SlashCommandBuilder()
                .setName('topaktiflik')
                .setDescription('Ventra ekibine ait Letra aktiflik ilk 10 liderlik tablosunu görüntülersiniz.')
                .toJSON()
        ];

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[BAŞARILI] Sadece /aktiflik ve /topaktiflik komutları yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }

    setInterval(async () => {
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            if (!guild) return;

            await guild.members.fetch({ withPresences: true }).catch(() => {});

            guild.members.cache.forEach(member => {
                if (!member.presence || !member.presence.activities) return;

                const isPlayingLetra = member.presence.activities.some(act => {
                    if (!act || act.type !== 0) return false;
                    const gameName = act.name.toLowerCase();
                    return gameName.includes('letra');
                });
                
                if (isPlayingLetra) {
                    addPointToUser(member);
                }
            });
        } catch (err) {
            console.error("Periyodik tarama hatası:", err);
        }
    }, 10000);
});

client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        // 1. /aktiflik Komutu (Kişinin kendi puanı - Sadece kendisine görünür)
        if (interaction.commandName === 'aktiflik') {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});

            let db = readDB();
            const key = `stats_${interaction.user.id}`;
            const uData = db[key];

            const embed = new EmbedBuilder()
                .setColor('#0ea5e9')
                .setTitle('👤 Ventra - Aktiflik Profiliniz')
                .setTimestamp();

            if (!uData || uData.total === 0) {
                embed.setDescription('Henüz kayıtlı bir Letra aktiflik puanın bulunmuyor. Letra oynayarak puan kazanmaya başlayabilirsin!');
            } else {
                updateResetFields(uData);
                embed.setDescription(`Hey <@${interaction.user.id}>, Letra sunucusundaki güncel istatistiklerin:`)
                    .addFields(
                        { name: '📅 Günlük Puan', value: `\`${uData.daily} Puan\``, inline: true },
                        { name: '📆 Haftalık Puan', value: `\`${uData.weekly} Puan\``, inline: true },
                        { name: '🗓️ Aylık Puan', value: `\`${uData.monthly} Puan\``, inline: true },
                        { name: '🏆 Toplam Puan', value: `\`${uData.total} Puan\``, inline: false }
                    );
            }

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        // 2. /topaktiflik Komutu (İlk 10 listesi)
        if (interaction.commandName === 'topaktiflik') {
            await interaction.deferReply().catch(() => {});

            let db = readDB();
            const leaderboard = Object.keys(db)
                .filter(key => key.startsWith('stats_'))
                .map(key => {
                    const uData = db[key] || {};
                    updateResetFields(uData);
                    return {
                        userId: uData.id || key.replace('stats_', ''),
                        displayName: uData.displayName || uData.username || 'Oyuncu',
                        daily: uData.daily || 0,
                        weekly: uData.weekly || 0,
                        monthly: uData.monthly || 0,
                        total: uData.total || 0
                    };
                })
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor('#10b981')
                .setTitle('🏆 Ventra x Letra - Top 10 Liderlik Tablosu')
                .setDescription('Ventra ekibinin Letra sunucusundaki en aktif ilk 10 oyuncusu:')
                .setTimestamp();

            if (leaderboard.length === 0) {
                embed.addFields({ name: 'Durum', value: 'Henüz kaydedilmiş bir Letra aktiflik puanı bulunmuyor.' });
            } else {
                let finalDesc = '';
                leaderboard.forEach((item, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
                    finalDesc += `${medal} <@${item.userId}>\n> Günlük: \`${item.daily}\` | Haftalık: \`${item.weekly}\` | Aylık: \`${item.monthly}\` | **Toplam: \`${item.total} Puan\`**\n\n`;
                });
                embed.addFields({ name: '📊 Sıralama', value: finalDesc });
            }

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {
        console.log("Interaction hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda.`));
client.login(process.env.TOKEN);
