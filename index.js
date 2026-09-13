require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, REST, Routes 
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('croxydb');

const client = new Client({
    intents: Object.values(GatewayIntentBits),
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});

// Slash Komut Listesi
const commands = [
    {
        name: 'ticket-kur',
        description: 'Sunucuya butonlu destek sistemi kurar.'
    },
    {
        name: 'sil',
        description: 'Mesajları siler.',
        options: [{ name: 'miktar', type: 4, description: 'Silinecek miktar (1-100)', required: true }]
    }
];

// Bot Hazır Olduğunda Komutları ANINDA Tüm Sunuculara Yükle
client.once('ready', async () => {
    console.log(`[🚀 EFSANE BOT] ${client.user.tag} devrede!`);
    client.user.setActivity('Web Panelden Yönetiliyor', { type: 3 });

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        // Global yerine anında görünmesi için mevcut sunuculara doğrudan basıyoruz
        client.guilds.cache.forEach(async (guild) => {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: commands }
            );
        });
        console.log('[⚡] Slash komutları tüm sunuculara anında yüklendi!');
    } catch (error) { 
        console.error('[HATA] Komut yükleme hatası:', error); 
    }
});

// Otomatik Sistemler
client.on('guildMemberAdd', async (member) => {
    const autoRoleId = db.fetch(`autorole_${member.guild.id}`);
    const welcomeChannelId = db.fetch(`welcomechannel_${member.guild.id}`);

    if (autoRoleId) member.roles.add(autoRoleId).catch(() => {});
    if (welcomeChannelId) {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle("🌌 Hoş Geldin!")
                .setDescription(`${member} katıldı! Toplam **${member.guild.memberCount}** kişiyiz.`)
                .setColor("#8b5cf6");
            channel.send({ embeds: [embed] });
        }
    }
});

// Interaction (Slash & Buton) Yakalayıcı
client.on('interactionCreate', async (interaction) => {
    // 1. SLASH KOMUTLAR
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ticket-kur') {
            await interaction.deferReply({ ephemeral: true });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_ticket')
                    .setLabel('📩 Destek Talebi Aç')
                    .setStyle(ButtonStyle.Primary)
            );

            const embed = new EmbedBuilder()
                .setTitle('🎫 Destek Merkezi')
                .setDescription('Bir sorununuz veya talebiniz varsa aşağıdaki butona basarak talep açabilirsiniz.')
                .setColor('#6366f1');

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return await interaction.editReply({ content: '✅ Ticket paneli başarıyla oluşturuldu!' });
        }

        if (interaction.commandName === 'sil') {
            await interaction.deferReply({ ephemeral: true });
            const miktar = interaction.options.getInteger('miktar');

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                return await interaction.editReply({ content: '❌ Bu komut için yetkin yetersiz!' });
            }

            await interaction.channel.bulkDelete(miktar, true).catch(() => {});
            return await interaction.editReply({ content: `🧹 ${miktar} adet mesaj temizlendi.` });
        }
    }

    // 2. BUTON ETKİLEŞİMLERİ
    if (interaction.isButton()) {
        if (interaction.customId === 'btn_ticket') {
            // "Uygulama yanıt vermedi" hatasını önlemek için anında erteleme
            await interaction.deferReply({ ephemeral: true });

            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            return await interaction.editReply({ content: `✅ Biletiniz oluşturuldu: ${channel}` });
        }
    }
});

// Web Panel API
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'gizli', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => {
    const botData = client.user ? {
        username: client.user.username,
        avatarURL: () => client.user.displayAvatarURL()
    } : { username: 'Efsane Bot', avatarURL: () => null };

    const guilds = client.guilds ? client.guilds.cache.map(g => ({ id: g.id, name: g.name, icon: g.iconURL() })) : [];
    
    res.render('index', {
        bot: botData,
        guildsCount: client.guilds ? client.guilds.cache.size : 0,
        usersCount: client.guilds ? client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0) : 0,
        guilds: guilds,
        db: db
    });
});

app.post('/api/settings/:guildId', (req, res) => {
    const { guildId } = req.params;
    const { autoRoleId, welcomeChannelId, antiSwear } = req.body;
    db.set(`autorole_${guildId}`, autoRoleId || null);
    db.set(`welcomechannel_${guildId}`, welcomeChannelId || null);
    db.set(`antiswear_${guildId}`, antiSwear === 'on');
    res.redirect('/');
});

app.listen(process.env.PORT || 3000, () => console.log(`[🌐 WEB] Panel yayında.`));
client.login(process.env.TOKEN);
