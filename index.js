require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits 
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('croxydb');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});

client.once('ready', () => {
    console.log(`[BOT] ${client.user.tag} olarak aktif!`);
});

// Oto-Rol & Karşılama
client.on('guildMemberAdd', async (member) => {
    const autoRoleId = db.fetch(`autorole_${member.guild.id}`);
    const welcomeChannelId = db.fetch(`welcomechannel_${member.guild.id}`);

    if (autoRoleId) {
        const role = member.guild.roles.cache.get(autoRoleId);
        if (role) member.roles.add(role).catch(() => {});
    }

    if (welcomeChannelId) {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle("Aramıza Biri Katıldı!")
                .setDescription(`Hoş geldin ${member}! Sunucumuz **${member.guild.memberCount}** kişi oldu.`)
                .setColor("#38bdf8");
            channel.send({ embeds: [embed] });
        }
    }
});

// Küfür Engelleme
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const antiSwear = db.fetch(`antiswear_${message.guild.id}`);
    if (antiSwear) {
        const badWords = ["amk", "aq", "piç", "sik", "orospu"];
        if (badWords.some(w => message.content.toLowerCase().includes(w))) {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                message.delete();
            }
        }
    }
});

// Buton Etkileşimi (Rol Alma)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('btn_role_')) {
        const roleId = interaction.customId.replace('btn_role_', '');
        const role = interaction.guild.roles.cache.get(roleId);
        if (role) {
            if (interaction.member.roles.cache.has(roleId)) {
                await interaction.member.roles.remove(role);
                interaction.reply({ content: `**${role.name}** rolü çıkarıldı.`, ephemeral: true });
            } else {
                await interaction.member.roles.add(role);
                interaction.reply({ content: `**${role.name}** rolü verildi!`, ephemeral: true });
            }
        }
    }
});

// Web Panel
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));

app.get('/', (req, res) => {
    const guilds = client.guilds.cache.map(g => ({ id: g.id, name: g.name }));
    res.render('index', {
        botName: client.user ? client.user.username : 'Bot',
        guildsCount: client.guilds.cache.size,
        guilds: guilds
    });
});

app.post('/api/settings/:guildId', (req, res) => {
    const { autoRoleId, welcomeChannelId, antiSwear } = req.body;
    if (autoRoleId) db.set(`autorole_${req.params.guildId}`, autoRoleId);
    if (welcomeChannelId) db.set(`welcomechannel_${req.params.guildId}`, welcomeChannelId);
    db.set(`antiswear_${req.params.guildId}`, antiSwear === 'on');
    res.redirect('/');
});

app.post('/api/send-role-panel', async (req, res) => {
    const { channelId, roleId, buttonLabel } = req.body;
    const channel = client.channels.cache.get(channelId);
    if (channel) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_role_${roleId}`).setLabel(buttonLabel || 'Rol Al/Bırak').setStyle(ButtonStyle.Primary)
        );
        await channel.send({ content: 'Rol almak için butona tıkla:', components: [row] });
    }
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[PANEL] http://localhost:${PORT} adresinde yayında.`));
client.login(process.env.TOKEN);