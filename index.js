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

// Gelişmiş Komut Seti
const commands = [
    { name: 'ticket-kur', description: '🎫 Destek bileti sistemini kurar.' },
    { name: 'sil', description: '🧹 Mesajları temizler.', options: [{ name: 'miktar', type: 4, description: '1-100 arası miktar', required: true }] },
    { name: 'ban', description: '🔨 Kullanıcıyı sunucudan yasaklar.', options: [{ name: 'kullanici', type: 6, description: 'Üye', required: true }, { name: 'sebep', type: 3, description: 'Yasaklama sebebi', required: false }] },
    { name: 'kick', description: '👢 Kullanıcıyı sunucudan atar.', options: [{ name: 'kullanici', type: 6, description: 'Üye', required: true }] },
    { name: 'seviye', description: '📊 Mevcut XP ve seviyeni gösterir.' },
    { name: 'istatistik', description: '⚡ Botun anlık sistem ve sunucu verilerini gösterir.' }
];

client.once('ready', async () => {
    console.log(`[🚀 VENTRA CORE] ${client.user.tag} devrede!`);
    client.user.setActivity('Ventra Cloud Dashboard | v2.0', { type: 3 });

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        client.guilds.cache.forEach(async (guild) => {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
        });
        console.log('[⚡] Tüm modül komutları Discord API\'ye yüklendi!');
    } catch (error) { console.error(error); }
});

// Otomatik Sistemler (Oto-Rol, Karşılama, XP, Oto-Mod, Link Engeli)
client.on('guildMemberAdd', async (member) => {
    const autoRoleId = db.fetch(`autorole_${member.guild.id}`);
    const welcomeChannelId = db.fetch(`welcomechannel_${member.guild.id}`);

    if (autoRoleId) member.roles.add(autoRoleId).catch(() => {});
    if (welcomeChannelId) {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle("🌌 Yeni Bir Üye Katıldı!")
                .setDescription(`Aramıza hoş geldin ${member}! Seninle birlikte **${member.guild.memberCount}** kişi olduk.`)
                .setColor("#8b5cf6")
                .setThumbnail(member.user.displayAvatarURL());
            channel.send({ embeds: [embed] });
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Reklam / Link Engeli Modülü
    if (db.fetch(`antilink_${message.guild.id}`)) {
        const linkRegex = /(https?:\/\/[^\s]+)/g;
        if (linkRegex.test(message.content) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            message.delete().catch(() => {});
            return message.channel.send(`⚠️ ${message.author}, bu sunucuda link paylaşımı engellenmiştir!`).then(m => setTimeout(() => m.delete(), 3000));
        }
    }

    // Küfür Engeli Modülü
    if (db.fetch(`antiswear_${message.guild.id}`)) {
        const badWords = ["amk", "aq", "piç", "orospu", "sik", "oc"];
        if (badWords.some(w => message.content.toLowerCase().includes(w)) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            message.delete().catch(() => {});
            return message.channel.send(`⚠️ ${message.author}, küfür/hakaret içerikli mesajlar engellenmektedir!`).then(m => setTimeout(() => m.delete(), 3000));
        }
    }

    // XP & Leveling Sistemi
    const xpKey = `xp_${message.guild.id}_${message.author.id}`;
    const levelKey = `level_${message.guild.id}_${message.author.id}`;
    db.add(xpKey, Math.floor(Math.random() * 10) + 10);
    
    let xp = db.fetch(xpKey), level = db.fetch(levelKey) || 0, nextXp = (level + 1) * 200;
    if (xp >= nextXp) {
        db.add(levelKey, 1);
        message.channel.send(`🎉 Tebrikler ${message.author}! Level atladın: **Seviye ${level + 1}** 🚀`);
    }
});

// Slash Komut Yanıtlayıcıları
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await interaction.deferReply({ ephemeral: true });

        if (interaction.commandName === 'ticket-kur') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_ticket').setLabel('📩 Destek Talebi Oluştur').setStyle(ButtonStyle.Primary)
            );
            const embed = new EmbedBuilder()
                .setTitle('🎫 Destek & Müşteri Hizmetleri')
                .setDescription('Bir konuda yardıma veya yetkili desteğine ihtiyacınız varsa aşağıdaki butona basarak özel bilet açabilirsiniz.')
                .setColor('#6366f1');

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return await interaction.editReply({ content: '✅ Destek paneli başarıyla kuruldu!' });
        }

        if (interaction.commandName === 'sil') {
            const miktar = interaction.options.getInteger('miktar');
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return await interaction.editReply('❌ Yetkiniz yetersiz!');
            await interaction.channel.bulkDelete(miktar, true).catch(() => {});
            return await interaction.editReply({ content: `🧹 **${miktar}** adet mesaj temizlendi.` });
        }

        if (interaction.commandName === 'seviye') {
            const xp = db.fetch(`xp_${interaction.guild.id}_${interaction.user.id}`) || 0;
            const level = db.fetch(`level_${interaction.guild.id}_${interaction.user.id}`) || 0;
            return await interaction.editReply({ content: `📊 **Seviyen:** ${level} | **Toplam XP:** ${xp}` });
        }

        if (interaction.commandName === 'istatistik') {
            const embed = new EmbedBuilder()
                .setTitle('⚡ Ventra Bot İstatistikleri')
                .addFields(
                    { name: 'Sunucu Sayısı', value: `${client.guilds.cache.size}`, inline: true },
                    { name: 'Toplam Kullanıcı', value: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`, inline: true },
                    { name: 'Gecikme (Ping)', value: `${client.ws.ping}ms`, inline: true }
                )
                .setColor('#a855f7');
            return await interaction.editReply({ embeds: [embed] });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'btn_ticket') {
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

// Express Web Panel Engine
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'ventra_secret_123', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => {
    const botData = client.user ? { username: client.user.username, avatarURL: () => client.user.displayAvatarURL() } : { username: 'Ventra Cloud', avatarURL: () => null };
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
    const { autoRoleId, welcomeChannelId, antiSwear, antiLink } = req.body;
    db.set(`autorole_${guildId}`, autoRoleId || null);
    db.set(`welcomechannel_${guildId}`, welcomeChannelId || null);
    db.set(`antiswear_${guildId}`, antiSwear === 'on');
    db.set(`antilink_${guildId}`, antiLink === 'on');
    res.redirect('/');
});

app.listen(process.env.PORT || 3000, () => console.log(`[🌐 WEB] Panel aktif.`));
client.login(process.env.TOKEN);
