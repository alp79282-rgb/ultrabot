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

// Tarih Yardımcı Fonksiyonları
function getTodayKey() {
    return new Date().toISOString().split('T')[0]; // Örn: 2026-09-13
}

function getMonthKey() {
    return getTodayKey().substring(0, 7); // Örn: 2026-09
}

function getWeekKey() {
    const d = new Date();
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${weekNo}`; // Örn: 2026-W37
}

// Puanı "X Saat Y Dakika" Formatına Çeviren Fonksiyon
function formatTime(puan) {
    if (!puan || puan <= 0) return '0 dk';
    const toplamSaniye = puan * 10;
    const saat = Math.floor(toplamSaniye / 3600);
    const dakika = Math.floor((toplamSaniye % 3600) / 60);
    const saniye = toplamSaniye % 60;

    let res = '';
    if (saat > 0) res += `${saat} saat `;
    if (dakika > 0) res += `${dakika} dk `;
    if (saat === 0 && dakika === 0) res = `${saniye} sn`;
    return res.trim();
}

// Web Paneli Rotaları
app.get('/', async (req, res) => {
    try {
        let rawData = db.all();
        let allData = [];

        if (Array.isArray(rawData)) {
            allData = rawData.map(item => ({ ID: item.ID || item.key, data: item.data || item.value }));
        } else if (rawData && typeof rawData === 'object') {
            allData = Object.entries(rawData).map(([ID, val]) => ({ ID, data: typeof val === 'object' ? (val.data || val.value) : val }));
        }

        const todayKey = getTodayKey();
        const weekKey = getWeekKey();
        const monthKey = getMonthKey();

        const activeRecords = allData
            .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('stats_'))
            .map(item => {
                const uData = item.data || {};
                const dailyPoints = (uData.daily && uData.daily[todayKey]) || 0;
                const weeklyPoints = (uData.weekly && uData.weekly[weekKey]) || 0;
                const monthlyPoints = (uData.monthly && uData.monthly[monthKey]) || 0;
                const totalPoints = uData.total || 0;

                return {
                    userId: uData.id || item.ID.replace('stats_', ''),
                    username: uData.username || 'Bilinmiyor',
                    displayName: uData.displayName || uData.username || 'Bilinmiyor',
                    avatar: uData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
                    dailyStr: formatTime(dailyPoints),
                    weeklyStr: formatTime(weeklyPoints),
                    monthlyStr: formatTime(monthlyPoints),
                    totalStr: formatTime(totalPoints),
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
                .setDescription('Kişisel Letra XII oyun sürenizi ve detaylı istatistiklerinizi görüntülersiniz.')
                .toJSON()
        ];

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[BAŞARILI] /aktiflikbot komutu yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }

    // ARKA PLAN TARAMASI (10 Saniyede Bir)
    setInterval(async () => {
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            if (!guild) return;

            const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
            if (!members) return;

            const todayKey = getTodayKey();
            const weekKey = getWeekKey();
            const monthKey = getMonthKey();

            members.forEach(member => {
                if (!member.presence || !member.presence.activities) return;

                member.presence.activities.forEach(act => {
                    if (act && act.name) {
                        const name = act.name.toLowerCase();
                        if (name.includes('counter') || name.includes('cs') || name.includes('letra')) {
                            
                            // Kullanıcı veri yapısını çek veya oluştur
                            let userData = db.get(`stats_${member.id}`) || {
                                id: member.id,
                                username: member.user.username,
                                displayName: member.displayName || member.user.globalName || member.user.username,
                                avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
                                total: db.get(`aktiflik_${member.id}`) || 0,
                                daily: {},
                                weekly: {},
                                monthly: {}
                            };

                            // Profil bilgilerini güncelle
                            userData.username = member.user.username;
                            userData.displayName = member.displayName || member.user.globalName || member.user.username;
                            userData.avatar = member.user.displayAvatarURL({ extension: 'png', size: 128 });

                            // Süre puanlarını artır
                            userData.total = (userData.total || 0) + 1;
                            
                            if (!userData.daily) userData.daily = {};
                            userData.daily[todayKey] = (userData.daily[todayKey] || 0) + 1;

                            if (!userData.weekly) userData.weekly = {};
                            userData.weekly[weekKey] = (userData.weekly[weekKey] || 0) + 1;

                            if (!userData.monthly) userData.monthly = {};
                            userData.monthly[monthKey] = (userData.monthly[monthKey] || 0) + 1;

                            // Veritabanına kaydet
                            db.set(`stats_${member.id}`, userData);
                            console.log(`[OYUN YAKALANDI] ${userData.displayName} (${member.user.username}) | Toplam: ${formatTime(userData.total)}`);
                        }
                    }
                });
            });
        } catch (err) {
            console.error("Periyodik tarama hatası:", err);
        }
    }, 10000);
});

// Slash Komutu (/aktiflikbot)
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'aktiflikbot') {
            await interaction.deferReply().catch(() => {});

            const todayKey = getTodayKey();
            const weekKey = getWeekKey();
            const monthKey = getMonthKey();

            const userData = db.get(`stats_${interaction.user.id}`);

            const embed = new EmbedBuilder()
                .setColor('#0ea5e9')
                .setTitle(`🎮 ${interaction.user.username} - Letra XII Aktiflik İstatistikleri`)
                .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
                .setTimestamp();

            if (!userData) {
                embed.setDescription('Henüz kaydedilmiş bir oyun süreniz bulunmuyor.');
            } else {
                const daily = formatTime((userData.daily && userData.daily[todayKey]) || 0);
                const weekly = formatTime((userData.weekly && userData.weekly[weekKey]) || 0);
                const monthly = formatTime((userData.monthly && userData.monthly[monthKey]) || 0);
                const total = formatTime(userData.total || 0);

                embed.addFields(
                    { name: '📅 Bugün', value: `\`${daily}\``, inline: true },
                    { name: '🗓️ Bu Hafta', value: `\`${weekly}\``, inline: true },
                    { name: '📆 Bu Ay', value: `\`${monthly}\``, inline: true },
                    { name: '🏆 Toplam Süre', value: `\`${total}\``, inline: false }
                );
            }

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {
        console.error("Interaction hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda.`));
client.login(process.env.TOKEN);
