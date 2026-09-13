require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        // Komut adını ekrandakine birebir uyarladık: 'aktiflikbot'
        const commands = [
            new SlashCommandBuilder()
                .setName('aktiflikbot')
                .setDescription('Kişisel Letra XII oyun sürenizi ve FiveM durumunuzu görüntülersiniz.')
                .toJSON()
        ];

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[BAŞARILI] /aktiflikbot komutu sunucuya yüklendi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }
});

client.on('presenceUpdate', (oldPresence, newPresence) => {
    try {
        if (!newPresence || !newPresence.member) return;
        const userId = newPresence.member.id;
        const playingGame = newPresence.activities.find(act => act.type === 0);

        if (playingGame) {
            let currentCount = 0;
            try { currentCount = db.get(`aktiflik_${userId}`) || 0; } catch(e){}
            try { db.set(`aktiflik_${userId}`, currentCount + 1); } catch(e){}
        }
    } catch (err) {}
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            // Kontrol edilecek komut adı güncellendi
            if (interaction.commandName === 'aktiflikbot') {
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                const userId = interaction.user.id;
                let userScore = 0;
                
                try {
                    userScore = db.get(`aktiflik_${userId}`) || 0;
                } catch (dbErr) {
                    userScore = 0;
                }

                const embed = new EmbedBuilder()
                    .setColor('#0ea5e9')
                    .setTitle('👤 Aktiflik Durum Kontrolü')
                    .setDescription(`Merhaba <@${userId}>!\n\nKayıtlı aktiflik süreniz/puanınız: **${userScore}**\n\nDurumunuzu onaylamak için aşağıdaki butona tıklayabilirsiniz.`)
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('aktiflik_onayla_btn')
                        .setLabel('Aktiflik Onayla')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅')
                );

                await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
            }
        } 
        else if (interaction.isButton()) {
            if (interaction.customId === 'aktiflik_onayla_btn') {
                try {
                    db.set(`onay_${interaction.user.id}`, true);
                } catch(e){}

                const successEmbed = new EmbedBuilder()
                    .setColor('#22c55e')
                    .setTitle('🎉 Aktiflik Başarıyla Onaylandı!')
                    .setDescription('Aktiflik durumunuz sistem tarafından kaydedildi.')
                    .setTimestamp();

                await interaction.update({ embeds: [successEmbed], components: [] }).catch(() => {});
            }
        }
    } catch (err) {
        console.error("Interaction genel hata:", err);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Web panel ${PORT} portunda.`));
client.login(process.env.TOKEN);
