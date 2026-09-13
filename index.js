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

const commands = [
    { name: 'ticket-kur', description: 'Destek bileti panelini kanala kurar.' },
    { name: 'whitelist-kur', description: 'Kayıt ve başvuru panelini kanala kurar.' },
    { name: 'mesai-kur', description: 'LSPD/EMS için mesai takip panelini kurar.' },
    { name: 'sil', description: 'Belirtilen miktarda mesajı temizler.', options: [{ name: 'miktar', type: 4, description: '1-100 arası miktar', required: true }] },
    { name: 'ban', description: 'Kullanıcıyı sunucudan yasaklar.', options: [{ name: 'kullanici', type: 6, description: 'Yasaklanacak üye', required: true }, { name: 'sebep', type: 3, description: 'Sebep', required: false }] },
    { name: 'kick', description: 'Kullanıcıyı sunucudan atar.', options: [{ name: 'kullanici', type: 6, description: 'Atılacak üye', required: true }] },
    { name: 'wl-ver', description: 'Kullanıcıya Whitelist rolü verir.', options: [{ name: 'kullanici', type: 6, description: 'Onaylanacak üye', required: true }, { name: 'hex', type: 3, description: 'Steam Hex ID', required: true }] },
    { name: 'durum', description: 'FiveM sunucu aktiflik ve oyuncu istatistiklerini gösterir.' }
];

client.once('ready', async () => {
    client.user.setActivity('Ventra FiveM Infrastructure', { type: 3 });
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        client.guilds.cache.forEach(async (guild) => {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
        });
    } catch (error) {}
});

client.on('guildMemberAdd', async (member) => {
    const unregRole = db.fetch(`unregistered_role_${member.guild.id}`);
    const welcomeChannel = db.fetch(`welcomechannel_${member.guild.id}`);

    if (unregRole) member.roles.add(unregRole).catch(() => {});
    if (welcomeChannel) {
        const channel = member.guild.channels.cache.get(welcomeChannel);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('Sunucuya Hoş Geldin')
                .setDescription(`${member} katıldı. Whitelist başvurusu yapmak için ilgili kanalı kullanabilirsiniz.`)
                .setColor('#2563eb');
            channel.send({ embeds: [embed] });
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (db.fetch(`antilink_${message.guild.id}`)) {
        const linkRegex = /(https?:\/\/[^\s]+)/g;
        if (linkRegex.test(message.content) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            message.delete().catch(() => {});
            return message.channel.send(`${message.author}, bağlantı paylaşımı engellendi.`).then(m => setTimeout(() => m.delete(), 3000));
        }
    }

    if (db.fetch(`antiswear_${message.guild.id}`)) {
        const badWords = ["amk", "aq", "piç", "orospu", "sik", "oc"];
        if (badWords.some(w => message.content.toLowerCase().includes(w)) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            message.delete().catch(() => {});
            return message.channel.send(`${message.author}, mesajınız içerik filtresine takıldı.`).then(m => setTimeout(() => m.delete(), 3000));
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await interaction.deferReply({ ephemeral: true });

        if (interaction.commandName === 'ticket-kur') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_ticket').setLabel('Destek Talebi Oluştur').setStyle(ButtonStyle.Primary)
            );
            const embed = new EmbedBuilder()
                .setTitle('FiveM Oyuncu Destek Merkezi')
                .setDescription('Oyuniçi veya teknik sorunlarınız için talep oluşturabilirsiniz.')
                .setColor('#2563eb');

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return await interaction.editReply({ content: 'Destek paneli oluşturuldu.' });
        }

        if (interaction.commandName === 'whitelist-kur') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_wl_apply').setLabel('Whitelist Başvurusu').setStyle(ButtonStyle.Success)
            );
            const embed = new EmbedBuilder()
                .setTitle('Whitelist Başvuru Paneli')
                .setDescription('Sunucuya erişim sağlamak için başvuru yapabilirsiniz.')
                .setColor('#10b981');

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return await interaction.editReply({ content: 'Whitelist paneli kuruldu.' });
        }

        if (interaction.commandName === 'mesai-kur') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_duty_on').setLabel('Mesai Giriş').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_duty_off').setLabel('Mesai Çıkış').setStyle(ButtonStyle.Danger)
            );
            const embed = new EmbedBuilder()
                .setTitle('LSPD / EMS Mesai Takip Paneli')
                .setDescription('Giriş ve çıkış saatlerinizi kaydetmek için butonları kullanın.')
                .setColor('#f59e0b');

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return await interaction.editReply({ content: 'Mesai takip paneli kuruldu.' });
        }

        if (interaction.commandName === 'wl-ver') {
            const target = interaction.options.getUser('kullanici');
            const hex = interaction.options.getString('hex');
            const wlRole = db.fetch(`wl_role_${interaction.guild.id}`);
            const unregRole = db.fetch(`unregistered_role_${interaction.guild.id}`);

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) return await interaction.editReply('Yetersiz yetki.');

            const member = await interaction.guild.members.fetch(target.id);
            if (wlRole) await member.roles.add(wlRole).catch(() => {});
            if (unregRole) await member.roles.remove(unregRole).catch(() => {});

            db.set(`hex_${target.id}`, hex);
            return await interaction.editReply({ content: `${target.tag} kullanıcısına Whitelist tanımlandı. Hex ID: ${hex}` });
        }

        if (interaction.commandName === 'sil') {
            const miktar = interaction.options.getInteger('miktar');
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return await interaction.editReply('Yetersiz yetki.');
            await interaction.channel.bulkDelete(miktar, true).catch(() => {});
            return await interaction.editReply({ content: `${miktar} adet mesaj silindi.` });
        }

        if (interaction.commandName === 'ban') {
            const target = interaction.options.getUser('kullanici');
            const reason = interaction.options.getString('sebep') || 'Belirtilmedi';
            if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) return await interaction.editReply('Yetersiz yetki.');
            await interaction.guild.members.ban(target, { reason }).catch(() => {});
            return await interaction.editReply({ content: `${target.tag} uzaklaştırıldı.` });
        }

        if (interaction.commandName === 'kick') {
            const target = interaction.options.getUser('kullanici');
            if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) return await interaction.editReply('Yetersiz yetki.');
            await interaction.guild.members.kick(target).catch(() => {});
            return await interaction.editReply({ content: `${target.tag} atıldı.` });
        }

        if (interaction.commandName === 'durum') {
            const ip = db.fetch(`server_ip_${interaction.guild.id}`) || 'Tanımlanmadı';
            const embed = new EmbedBuilder()
                .setTitle('FiveM Sunucu Durumu')
                .addFields(
                    { name: 'Sunucu Adresi', value: `${ip}`, inline: true },
                    { name: 'Sistem Durumu', value: 'Aktif', inline: true }
                )
                .setColor('#2563eb');
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
            return await interaction.editReply({ content: `Destek kanalı açıldı: ${channel}` });
        }

        if (interaction.customId === 'btn_duty_on') {
            await interaction.deferReply({ ephemeral: true });
            db.set(`duty_${interaction.guild.id}_${interaction.user.id}`, Date.now());
            return await interaction.editReply({ content: 'Mesaiye giriş yapıldı.' });
        }

        if (interaction.customId === 'btn_duty_off') {
            await interaction.deferReply({ ephemeral: true });
            const startTime = db.fetch(`duty_${interaction.guild.id}_${interaction.user.id}`);
            if (!startTime) return await interaction.editReply({ content: 'Aktif mesai kaydınız bulunmuyor.' });
            
            const duration = Math.floor((Date.now() - startTime) / 1000 / 60);
            db.delete(`duty_${interaction.guild.id}_${interaction.user.id}`);
            return await interaction.editReply({ content: `Mesaiden çıkış yapıldı. Toplam süre: ${duration} dakika.` });
        }
    }
});

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'ventra_fivem_sec', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => {
    const botData = client.user ? { username: client.user.username, avatarURL: () => client.user.displayAvatarURL() } : { username: 'Ventra FiveM', avatarURL: () => null };
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
    const { serverIp, wlRoleId, unregRoleId, welcomeChannelId, logChannelId, antiSwear, antiLink } = req.body;

    db.set(`server_ip_${guildId}`, serverIp || null);
    db.set(`wl_role_${guildId}`, wlRoleId || null);
    db.set(`unregistered_role_${guildId}`, unregRoleId || null);
    db.set(`welcomechannel_${guildId}`, welcomeChannelId || null);
    db.set(`log_channel_${guildId}`, logChannelId || null);
    db.set(`antiswear_${guildId}`, antiSwear === 'on');
    db.set(`antilink_${guildId}`, antiLink === 'on');

    res.redirect('/');
});

app.listen(process.env.PORT || 3000, () => {});
client.login(process.env.TOKEN);
