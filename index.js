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
    console.log(`${client.user.tag} aktif! Komutlar yükleniyor.`);

    const commands = [
        new SlashCommandBuilder()
            .setName('aktiflikbot')
            .setDescription('Kişisel Letra XII oyun sürenizi ve FiveM durumunuzu görüntülersiniz.')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Slash komutu (/aktiflikbot) başarıyla yüklendi.');
    } catch (error) {
        console.error(error);
    }
});

// --- 2. DİSCORD ETKİLEŞİM VE BUTON YÖNETİMİ ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'aktiflikbot') {
            const userId = interaction.user.id;
            const guildId = interaction.guild.id;

            const dailyLogs = db.fetch(`sessions_daily_${guildId}_${userId}`) || [];
            const weeklyLogs = db.fetch(`sessions_weekly_${guildId}_${userId}`) || [];
            
            const totalDailyMin = dailyLogs.reduce((acc, l) => acc + l.duration, 0);
            const totalWeeklyMin = weeklyLogs.reduce((acc, l) => acc + l.duration, 0);

            // İstediğin gibi siteye yönlendirmeyen, doğrudan kontrol butonu
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('fivem_kontrol_btn')
                        .setLabel('🎮 FiveM Durumunu Kontrol Et')
                        .setStyle(ButtonStyle.Primary)
                );

            await interaction.reply({
                content: `📊 **Letra XII Kişisel Aktiflik Karnen**:\n\n` +
                         `⏱️ **Bugünkü Süre:** ${Math.floor(totalDailyMin / 60)} Saat ${totalDailyMin % 60} Dk\n` +
                         `📅 **Haftalık Süre:** ${Math.floor(totalWeeklyMin / 60)} Saat ${totalWeeklyMin % 60} Dk\n\n` +
                         `*Anlık durumunu ve FiveM bağlantını test etmek için aşağıdaki butona basabilirsin:*`,
                components: [row],
                ephemeral: true
            });
        }
    } 
    else if (interaction.isButton()) {
        if (interaction.customId === 'fivem_kontrol_btn') {
            const userId = interaction.user.id;
            const guildId = interaction.guild.id;
            
            // Üyenin anlık Discord presences verisini kontrol et
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            const presence = member ? member.presence : null;
            
            let statusText = "❌ Discord aktiviteleriniz kapalı veya sunucuda görünmüyorsunuz.";
            
            if (presence && presence.activities.length > 0) {
                const activity = presence.activities.find(act => 
                    act.name.toLowerCase().includes('fivem') || 
                    act.name.toLowerCase().includes('letra xii') ||
                    (act.details && act.details.toLowerCase().includes('letra xii'))
                );

                if (activity) {
                    statusText = `✅ **Harika!** FiveM / Letra XII üzerinde aktif olduğunuz tespit edildi.\n🔸 **Detay:** ${activity.details || activity.name}`;
                } else {
                    statusText = `⚠️ Discord'da aktifsiniz ancak oynadığınız oyun listemizde görünmüyor veya **Aktivite Durumunuz gizli** olabilir.\n*(Not: Etkinlik gizleyenler için Discord gizlilik ayarlarından "Oynadığın oyunu durum mesajı olarak göster" seçeneğinin açık olması gerekir.)*`;
                }
            } else {
                statusText = `⚠️ Aktif bir oyun algılanamadı. Etkinliklerinizin (Rich Presence) gizli olmadığından emin olun.`;
            }

            await interaction.reply({
                content: statusText,
                ephemeral: true
            });
        }
    }
});

// --- 3. FIVEM / LETRA XII RPC TAKİP MOTORU ---
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

// --- 4. YÖNETİCİLER İÇİN WEB DASHBOARD & OAUTH2 ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'letra_admin_secret',
    resave: false,
    saveUninitialized: false
}));

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

app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

// Sadece Yöneticiler İçin Kontrol Paneli
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/');

    const filter = req.query.filter || 'daily';
    const guilds = client.guilds.cache.map(g => {
        const members = g.members.cache.filter(m => !m.user.bot).map(m => {
            const livePresence = g.presences.cache.get(m.id);
            const liveActivity = livePresence ? livePresence.activities.find(act => 
                act.name.toLowerCase().includes('letra xii') || 
                (act.details && act.details.toLowerCase().includes('letra xii'))
            ) : null;

            const isOnline = liveActivity ? true : false;
            const rpcDetails = db.fetch(`rpc_info_${g.id}_${m.id}`) || (liveActivity ? liveActivity.details : 'Etkinlik Gizli / Oyunda Değil');

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
    console.log('Letra XII Bot ve Yönetici Paneli aktif.');
});

client.login(process.env.TOKEN);
