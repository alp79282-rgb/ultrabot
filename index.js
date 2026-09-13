require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, EmbedBuilder 
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');
const db = require('croxydb');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// --- 1. SLASH KOMUTLARINI KAYDETME ---
client.once('ready', async () => {
    console.log(`${client.user.tag} bulut sunucuya başarıyla bağlandı!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('aktifligim')
            .setDescription('Letra XII oyun sürenizi ve istatistiklerinizi görüntülersiniz.'),
        new SlashCommandBuilder()
            .setName('ekip-siralama')
            .setDescription('Ekibin anlık aktiflik sıralamasını gösterir.')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Tüm Discord Slash komutları yüklendi.');
    } catch (error) {
        console.error(error);
    }
});

// --- 2. DISCORD ETKİLEŞİMLERİ (KOMUTLAR & BUTONLAR) ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        if (interaction.commandName === 'aktifligim') {
            const dailyLogs = db.fetch(`sessions_daily_${guildId}_${userId}`) || [];
            const weeklyLogs = db.fetch(`sessions_weekly_${guildId}_${userId}`) || [];
            
            const totalDailyMin = dailyLogs.reduce((acc, l) => acc + l.duration, 0);
            const totalWeeklyMin = weeklyLogs.reduce((acc, l) => acc + l.duration, 0);

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('view_leaderboard')
                        .setLabel('🏆 Ekip Sıralamasını Gör')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setLabel('🌐 Cloud Web Dashboard')
                        .setStyle(ButtonStyle.Link)
                        .setUrl(process.env.DOMAIN || 'http://localhost:3000')
                );

            await interaction.reply({
                content: `📊 **Letra XII Kişisel Aktiflik Karnen**:\n\n` +
                         `⏱️ **Bugünkü Süre:** ${Math.floor(totalDailyMin / 60)} Saat ${totalDailyMin % 60} Dk\n` +
                         `📅 **Haftalık Süre:** ${Math.floor(totalWeeklyMin / 60)} Saat ${totalWeeklyMin % 60} Dk\n`,
                components: [row],
                ephemeral: true
            });
        } 
        else if (interaction.commandName === 'ekip-siralama') {
            const members = interaction.guild.members.cache.filter(m => !m.user.bot);
            let desc = '';
            
            const memberList = members.map(m => {
                const logs = db.fetch(`sessions_daily_${guildId}_${m.id}`) || [];
                const totalMin = logs.reduce((acc, l) => acc + l.duration, 0);
                return { name: m.user.tag, totalMin };
            }).sort((a, b) => b.totalMin - a.totalMin).slice(0, 10);

            memberList.forEach((m, index) => {
                desc += `**#${index + 1}** - ${m.name} : \`${Math.floor(m.totalMin / 60)}s ${m.totalMin % 60}dk\`\n`;
            });

            const embed = new EmbedBuilder()
                .setTitle('🏆 Letra XII Günlük Aktiflik Liderlik Tablosu')
                .setDescription(desc || 'Henüz veri bulunmuyor.')
                .setColor('#3b82f6')
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    } 
    else if (interaction.isButton()) {
        if (interaction.customId === 'view_leaderboard') {
            const guildId = interaction.guild.id;
            const members = interaction.guild.members.cache.filter(m => !m.user.bot);
            
            let desc = '';
            const memberList = members.map(m => {
                const logs = db.fetch(`sessions_daily_${guildId}_${m.id}`) || [];
                const totalMin = logs.reduce((acc, l) => acc + l.duration, 0);
                return { name: m.user.tag, totalMin };
            }).sort((a, b) => b.totalMin - a.totalMin).slice(0, 5);

            memberList.forEach((m, index) => {
                desc += `**#${index + 1}** - ${m.name} : \`${Math.floor(m.totalMin / 60)}s ${m.totalMin % 60}dk\`\n`;
            });

            await interaction.update({
                content: `🏆 **Anlık Günlük Sıralama Özeti:**\n\n${desc}`,
                components: interaction.message.components
            });
        }
    }
});

// --- 3. KUSURSUZ FIVEM / LETRA XII RPC TAKİP MOTORU ---
client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.member || newPresence.user.bot) return;

    const userId = newPresence.userId;
    const guildId = newPresence.guild.id;
    const now = Date.now();

    const activity = newPresence.activities.find(act => 
        act.name.toLowerCase().includes('fivem') || 
        act.name.toLowerCase().includes('letra xii') ||
        (act.details && act.details.toLowerCase().includes('letra xii'))
    );

    const isinOurServer = activity && (
        activity.name.toLowerCase().includes('letra xii') ||
        (activity.details && activity.details.toLowerCase().includes('letra xii')) ||
        (activity.state && activity.state.toLowerCase().includes('letra xii'))
    );

    const wasPlayingOurServer = db.fetch(`active_session_${guildId}_${userId}`) ? true : false;

    if (isinOurServer && !wasPlayingOurServer) {
        db.set(`active_session_${guildId}_${userId}`, now);
        if (activity.details) {
            db.set(`rpc_info_${guildId}_${userId}`, activity.details);
        }
    }

    if (!isinOurServer && wasPlayingOurServer) {
        const startTime = db.fetch(`active_session_${guildId}_${userId}`);
        if (startTime) {
            const durationMinutes = Math.floor((now - startTime) / (1000 * 60));
            
            db.delete(`active_session_${guildId}_${userId}`);
            db.delete(`rpc_info_${guildId}_${userId}`);

            const sessionRecord = { duration: durationMinutes, timestamp: now };
            
            ['daily', 'weekly', 'monthly'].forEach(period => {
                const logs = db.fetch(`sessions_${period}_${guildId}_${userId}`) || [];
                logs.push(sessionRecord);
                db.set(`sessions_${period}_${guildId}_${userId}`, logs);
            });
        }
    }
});

// --- 4. CLOUD EXPRESS WEB DASHBOARD & OAUTH2 ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'letra_cloud_secret_key',
    resave: false,
    saveUninitialized: false
}));

// OAuth2 Giriş Yolu
app.get('/login', (req, res) => {
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`);
});

// OAuth2 Callback
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');

    try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.REDIRECT_URI,
            }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const oauthData = await tokenResponse.json();
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${oauthData.access_token}` },
        });

        req.session.user = await userResponse.json();
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

// Ana Sayfa
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

// Cloud Yönetim Paneli (Dashboard)
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const filter = req.query.filter || 'daily';
    const guilds = client.guilds.cache.map(g => {
        const members = g.members.cache.filter(m => !m.user.bot).map(m => {
            const livePresence = g.presences.cache.get(m.id);
            const liveActivity = livePresence ? livePresence.activities.find(act => 
                act.name.toLowerCase().includes('letra xii') || 
                (act.details && act.details.toLowerCase().includes('letra xii'))
            ) : null;

            const isOnline = liveActivity ? true : false;
            const rpcDetails = db.fetch(`rpc_info_${g.id}_${m.id}`) || (liveActivity ? liveActivity.details : 'Sunucuda Değil');

            const rawLogs = db.fetch(`sessions_${filter}_${g.id}_${m.id}`) || [];
            const totalMinutes = rawLogs.reduce((acc, l) => acc + l.duration, 0);

            return {
                id: m.id,
                tag: m.user.tag,
                avatar: m.user.displayAvatarURL({ dynamic: true }),
                isOnline: isOnline,
                rpcDetails: rpcDetails,
                totalMinutes: totalMinutes
            };
        });

        members.sort((a, b) => b.totalMinutes - a.totalMinutes);
        return { id: g.id, name: g.name, members: members };
    });

    res.render('dashboard', { user: req.session.user, guilds, currentFilter: filter });
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Cloud Web Dashboard aktif: http://localhost:${process.env.PORT || 3000}`);
});

client.login(process.env.TOKEN);
