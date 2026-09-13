require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('croxydb');
.
const app = express();
const PORT = process.env.PORT || 10000;

// Discord Bot Kurulumu (Presence ve Member Intentleri Açık)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences, // Aktiflik durumunu okumak için HAYATİ ÖNEM TAŞIR
        GatewayIntentBits.GuildMessages
    ],
    partials: [Partials.User, Partials.Channel, Partials.GuildMember]
});

// Express & Session Ayarları
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'letra-xii-secret-key-987654',
    resave: false,
    saveUninitialized: false
}));

// --- WEB PANEL ROTALARI ---

app.get('/', async (req, res) => {
    let botUser = null;
    try {
        if (client.user) {
            botUser = { username: client.user.username, tag: client.user.tag };
        }
    } catch (e) {}

    // Veritabanından kayıtlı aktiflik sürelerini çekiyoruz
    const allData = db.all() || [];
    // Sadece aktiflik verilerini filtrele
    const activeRecords = allData.filter(item => item.ID.startsWith('aktiflik_')).map(item => ({
        userId: item.ID.replace('aktiflik_', ''),
        time: item.data
    }));

    res.render('index', { bot: botUser, records: activeRecords });
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- DISCORD BOT EVENTLERİ & AKTİFLİK TAKİBİ ---

client.once('clientReady', async () => {
    console.log(`[🚀 VENTRA CORE] ${client.user.tag} devrede!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('aktiflikbot')
            .setDescription('Ekip üyelerinin aktiflik durumunu ve istatistiklerini gösterir.')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('[⚡] Slash komutları Discord APIye yüklendi!');
    } catch (error) {
        console.error(error);
    }
});

// Oyuncuların aktivite durumunu (FiveM veya herhangi bir oyun) takip eden mekanizma
client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.member) return;
    
    const userId = newPresence.member.id;
    const activities = newPresence.activities;

    // Kullanıcının oynadığı bir oyun var mı kontrol ediyoruz
    const playingGame = activities.find(act => act.type === 0); // 0 = Playing (Oynuyor)

    if (playingGame) {
        // Örn: FiveM oynuyorsa veya genel oyundaysa veritabanına işliyoruz
        let currentCount = db.fetch(`aktiflik_${userId}`) || 0;
        db.set(`aktiflik_${userId}`, currentCount + 1); // Basit sayaç mantığı veya süre entegrasyonu
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'aktiflikbot') {
        await interaction.reply({
            content: `✅ Letra XII Aktiflik Takip Sistemi aktif! Üyelerin oyun durumları anlık olarak loglanıyor.`,
            ephemeral: true
        });
    }
});

// --- SUNUCUYU BAŞLAT ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[🌐 WEB] Panel ${PORT} portunda aktif.`);
});

if (!process.env.TOKEN) {
    console.error("[HATA] DISCORD TOKEN BULUNAMADI!");
} else {
    client.login(process.env.TOKEN);
}
