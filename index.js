require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Options } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const DB_FILE = path.join(__dirname, 'database.json');

// Güvenli ve kilitlenmesiz dosya okuma/yazma mekanizması
function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2), 'utf8');
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data || '{}');
    } catch (e) {
        console.error("Veritabanı okuma hatası:", e);
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

// Kesin ve hatasız tarih string üreticileri (Günlük, Haftalık, Aylık)
function getDayKey(date = new Date()) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getMonthKey(date = new Date()) {
    return date.toISOString().slice(0, 7); // YYYY-MM
}

function getWeekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo}`;
}

function updateResetFields(userData) {
    const currentDay = getDayKey();
    const currentWeek = getWeekKey();
    const currentMonth = getMonthKey();

    if (userData.lastDaily !== currentDay) {
        userData.daily = 0;
        userData.lastDaily = currentDay;
    }
    if (userData.lastWeekly !== currentWeek) {
        userData.weekly = 0;
        userData.lastWeekly = currentWeek;
    }
    if (userData.lastMonthly !== currentMonth) {
        userData.monthly = 0;
        userData.lastMonthly = currentMonth;
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

// ASIL SUNUCU ID'Sİ GÜNCELLENDİ
const GUILD_ID = '1548653462793748580';

function formatPoint(puan) {
    return `${puan || 0} Puan`;
}

// Toplu ve güvenli puan ekleme fonksiyonu (Dosya yarışını/çakışmasını kesinlikle engeller)
function addPointsBatch(memberIdsMap) {
    if (memberIdsMap.size === 0) return;

    let db = readDB();
    let updated = false;

    for (const [userId, member] of memberIdsMap.entries()) {
        const key = `stats_${userId}`;
        let userData = db[key] || {
            id: userId,
            username: member.user.username,
            displayName: member.displayName || member.user.globalName || member.user.username,
            avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png',
            daily: 0,
            weekly: 0,
            monthly: 0,
            total: 0,
            lastDaily: getDayKey(),
            lastWeekly: getWeekKey(),
            lastMonthly: getMonthKey()
        };

        updateResetFields(userData);

        userData.username = member.user.username;
        userData.displayName = member.displayName || member.user.globalName || member.user.username;
        userData.avatar = member.user.displayAvatarURL({ extension: 'png', size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';

        userData.daily += 1;
        userData.weekly += 1;
        userData.monthly += 1;
        userData.total += 1;

        db[key] = userData;
        updated = true;
    }

    if (updated) {
        writeDB(db);
    }
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
                .setName('aktiflikbot')
                .setDescription('Ventra Letra aktiflik paneli ve liderlik tablosuna erişirsiniz.')
                .toJSON()
        ];

        // Global komutları temizle, sadece asıl sunucuya özel komut yükle (hızlı senkronizasyon için)
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        
        console.log('[BAŞARILI] /aktiflikbot komutu asıl sunucuya yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }

    // Her 10 saniyede bir tarama döngüsü
    setInterval(async () => {
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            if (!guild) return;

            await guild.members.fetch({ withPresences: true }).catch(() => {});

            const activePlayingMembers = new Map();

            guild.members.cache.forEach(member => {
                if (!member.presence || !member.presence.activities) return;

                const isPlayingLetra = member.presence.activities.some(act => {
                    if (!act || (act.type !== 0 && act.type !== 4)) return false; 
                    const gameName = (act.name || '').toLowerCase();
                    const details = (act.details || '').toLowerCase();
                    const state = (act.state || '').toLowerCase();
                    return gameName.includes('letra') || details.includes('letra') || state.includes('letra');
                });
                
                if (isPlayingLetra) {
                    activePlayingMembers.set(member.id, member);
                }
            });

            if (activePlayingMembers.size > 0) {
                addPointsBatch(activePlayingMembers);
            }
        } catch (err) {
            console.error("Periyodik tarama hatası:", err);
        }
    }, 10000);
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'aktiflikbot') {
                await interaction.deferReply().catch(() => {});

                const embed = new EmbedBuilder()
                    .setColor('#6366f1')
                    .setTitle('🎮 Ventra x Letra Aktiflik Sistemi')
                    .setDescription('Aşağıdaki butonları kullanarak kişisel istatistiklerinizi inceleyebilir veya kategori seçerek liderlik tablosunu görüntüleyebilirsiniz.')
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_puan')
                        .setLabel('Puanını Gör')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('👤'),
                    new ButtonBuilder()
                        .setCustomId('btn_siralama_menu')
                        .setLabel('Sıralamayı Gör')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🏆')
                );

                await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
            }
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'btn_puan') {
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                let db = readDB();
                const key = `stats_${interaction.user.id}`;
                let uData = db[key];

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

            if (interaction.customId === 'btn_siralama_menu') {
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                const embed = new EmbedBuilder()
                    .setColor('#10b981')
                    .setTitle('🏆 Liderlik Tablosu Kategorileri')
                    .setDescription('Hangi döneme ait ilk 10 sıralamasını görmek istiyorsan lütfen aşağıdaki butonlardan birini seç:')
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('lb_daily').setLabel('Günlük').setStyle(ButtonStyle.Secondary).setEmoji('📅'),
                    new ButtonBuilder().setCustomId('lb_weekly').setLabel('Haftalık').setStyle(ButtonStyle.Secondary).setEmoji('📆'),
                    new ButtonBuilder().setCustomId('lb_monthly').setLabel('Aylık').setStyle(ButtonStyle.Secondary).setEmoji('🗓️'),
                    new ButtonBuilder().setCustomId('lb_total').setLabel('Toplam').setStyle(ButtonStyle.Success).setEmoji('🏆')
                );

                await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
            }

            if (['lb_daily', 'lb_weekly', 'lb_monthly', 'lb_total'].includes(interaction.customId)) {
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                let db = readDB();
                const type = interaction.customId.replace('lb_', '');

                let titleText = '';
                let colorHex = '#10b981';

                if (type === 'daily') {
                    titleText = '📅 Günlük En Aktif İlk 10 Oyuncu (Son 24 Saat)';
                    colorHex = '#3b82f6';
                } else if (type === 'weekly') {
                    titleText = '📆 Haftalık En Aktif İlk 10 Oyuncu (Son 7 Gün)';
                    colorHex = '#8b5cf6';
                } else if (type === 'monthly') {
                    titleText = '🗓️ Aylık En Aktif İlk 10 Oyuncu (Son 30 Gün)';
                    colorHex = '#ec4899';
                } else {
                    titleText = '🏆 Tüm Zamanların En Aktif İlk 10 Oyuncusu';
                    colorHex = '#10b981';
                }

                const leaderboard = Object.keys(db)
                    .filter(key => key.startsWith('stats_'))
                    .map(key => {
                        const uData = db[key] || {};
                        updateResetFields(uData);
                        return {
                            userId: uData.id || key.replace('stats_', ''),
                            score: uData[type] || 0
                        };
                    })
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 10);

                const embed = new EmbedBuilder()
                    .setColor(colorHex)
                    .setTitle(titleText)
                    .setTimestamp();

                if (leaderboard.length === 0 || leaderboard.every(item => item.score === 0)) {
                    embed.setDescription('Bu kategoride henüz kaydedilmiş bir puan bulunmuyor.');
                } else {
                    let finalDesc = '';
                    leaderboard.forEach((item, index) => {
                        if (item.score > 0) {
                            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
                            finalDesc += `${medal} <@${item.userId}> ➔ \`${item.score} Puan\`\n`;
                        }
                    });
                    
                    if (!finalDesc) {
                        finalDesc = 'Bu dönem için henüz puana sahip aktif oyuncu yok.';
                    }
                    
                    embed.setDescription(finalDesc);
                }

                await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
            }
        }
    } catch (err) {
        console.log("Interaction hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda çalışıyor.`));
client.login(process.env.TOKEN);
