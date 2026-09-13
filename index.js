require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('croxydb');

const app = express();
const PORT = process.env.PORT || 10000;

// Discord Bot Kurulumu
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
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
    let guildCount = 0;
    let totalUsers = 0;

    try {
        if (client.user) {
            botUser = { username: client.user.username, tag: client.user.tag };
        }
        guildCount = client.guilds.cache.size;
        totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    } catch (e) {}

    let rawData = db.all();
    let allData = Array.isArray(rawData) ? rawData : [];

    const activeRecords = allData
        .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('aktiflik_'))
        .map(item => ({
            userId: item.ID.replace('aktiflik_', ''),
            time: item.data
        }));

    res.render('index', { 
        bot: botUser, 
        records: activeRecords,
        stats: {
            guilds: guildCount,
            users: totalUsers,
            activeCount: activeRecords.length
        }
    });
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- DISCORD BOT EVENTLERİ & KOMUTLAR ---

client.once('ready', async () => {
    console.log(`[🚀 LETRA CORE] ${client.user.tag} aktif ve görevde!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('aktiflik')
            .setDescription('Ekip üyelerinin toplam aktiflik sürelerini listeler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
        
        new SlashCommandBuilder()
            .setName('aktiflik-sifirla')
            .setDescription('Belirtilen kullanıcının aktiflik süresini sıfırlar.')
            .addUserOption(option => 
                option.setName('kullanici')
                .setDescription('Süresi sıfırlanacak üye')
                .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('aktiflikkontrol')
            .setDescription('Kendi aktiflik durumunuzu görüntüler ve onaylarsınız.'),

        new SlashCommandBuilder()
            .setName('ticket-kur')
            .setDescription('Destek (Ticket) panelini bu kanala kurar.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('[⚡] Slash komutları Discord sistemine başarıyla kaydedildi!');
    } catch (error) {
        console.error("Komut yükleme hatası:", error);
    }
});

// Oyuncu aktivite takibi
client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.member) return;
    
    const userId = newPresence.member.id;
    const activities = newPresence.activities;
    const playingGame = activities.find(act => act.type === 0);

    if (playingGame) {
        let currentCount = db.fetch(`aktiflik_${userId}`) || 0;
        db.set(`aktiflik_${userId}`, currentCount + 1);
    }
});

// Slash Komut ve Buton Etkileşim Yönetimi
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'aktiflik') {
            await interaction.deferReply({ ephemeral: true });
            let rawData = db.all();
            let allData = Array.isArray(rawData) ? rawData : [];

            const records = allData
                .filter(item => item && item.ID && typeof item.ID === 'string' && item.ID.startsWith('aktiflik_'))
                .map(item => ({
                    userId: item.ID.replace('aktiflik_', ''),
                    time: item.data
                }))
                .sort((a, b) => b.time - a.time)
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor('#4f46e5')
                .setTitle('📊 Letra XII - Aktiflik İstatistikleri')
                .setDescription(records.length > 0 ? records.map((r, index) => `**${index + 1}.** <@${r.userId}> - \`${r.time} Puan/Süre\``).join('\n') : 'Henüz aktiflik verisi bulunmuyor.')
                .setFooter({ text: 'Letra XII Aktiflik Takip Sistemi' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'aktiflik-sifirla') {
            await interaction.deferReply({ ephemeral: true });
            const targetUser = interaction.options.getUser('kullanici');
            db.delete(`aktiflik_${targetUser.id}`);

            await interaction.editReply({
                content: `✅ <@${targetUser.id}> adlı kullanıcının aktiflik süresi başarıyla sıfırlandı.`
            });
        }

        if (commandName === 'aktiflikkontrol') {
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.user.id;
            const userScore = db.fetch(`aktiflik_${userId}`) || 0;

            const embed = new EmbedBuilder()
                .setColor('#0ea5e9')
                .setTitle('👤 Aktiflik Durum Kontrolü')
                .setDescription(`Merhaba <@${userId}>!\n\nŞu anki kayıtlı aktiflik puanınız/süreniz: **${userScore}**\n\nDurumunuzu onaylamak ve sisteme kaydetmek için aşağıdaki **Aktiflik Onayla** butonuna tıklayabilirsiniz.`)
                .setFooter({ text: 'Letra XII Güvenli Takip' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('aktiflik_onayla_btn')
                    .setLabel('Aktiflik Onayla')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket-kur') {
            await interaction.deferReply({ ephemeral: true });

            const embed = new EmbedBuilder()
                .setColor('#6366f1')
                .setTitle('🎫 Letra XII - Destek Sistemi')
                .setDescription('Sunucumuzda herhangi bir konuda destek almak, soru sormak veya bildirimde bulunmak için aşağıdaki **Destek Talebi Oluştur** butonuna tıklayabilirsiniz.')
                .setFooter({ text: 'Letra XII Destek Ekibi' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket_btn')
                    .setLabel('Destek Talebi Oluştur')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎫')
            );

            // Komutun kullanıldığı kanala ticket panelini gönderir
            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.editReply({ content: '✅ Destek paneli bu kanala başarıyla kuruldu!' });
        }
    } 
    else if (interaction.isButton()) {
        if (interaction.customId === 'aktiflik_onayla_btn') {
            const userId = interaction.user.id;
            db.set(`onay_${userId}`, true);

            const successEmbed = new EmbedBuilder()
                .setColor('#22c55e')
                .setTitle('🎉 Aktiflik Başarıyla Onaylandı!')
                .setDescription('Aktiflik durumunuz sistem tarafından doğrulandı ve kaydedildi. İyi oyunlar dileriz!')
                .setTimestamp();

            await interaction.update({ embeds: [successEmbed], components: [] });
        }

        if (interaction.customId === 'create_ticket_btn') {
            const guild = interaction.guild;
            const member = interaction.member;

            await interaction.reply({ content: '⏳ Destek kanalı oluşturuluyor, lütfen bekleyin...', ephemeral: true });

            try {
                // Her kullanıcıya özel ticket kanalı açma
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${member.user.username}`,
                    type: 0, // GuildText
                    permissionOverwrites: [
                        {
                            id: guild.id, // @everyone göremez
                            deny: ['ViewChannel'],
                        },
                        {
                            id: member.id, // Ticket açan kullanıcı görebilir ve yazabilir
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                        },
                    ],
                });

                const ticketEmbed = new EmbedBuilder()
                    .setColor('#10b981')
                    .setTitle(`🎫 Destek Talebi - ${member.user.tag}`)
                    .setDescription('Yetkililer kısa süre içinde sizinle ilgilenecektir. Talebi kapatmak için aşağıdaki butona basabilirsiniz.')
                    .setTimestamp();

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket_btn')
                        .setLabel('Talebi Kapat')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

                await ticketChannel.send({ content: `<@${member.id}>`, embeds: [ticketEmbed], components: [closeRow] });
                await interaction.editReply({ content: `✅ Destek kanalınız başarıyla oluşturuldu: <#${ticketChannel.id}>` });
            } catch (err) {
                console.error("Ticket oluşturma hatası:", err);
                await interaction.editReply({ content: '❌ Destek kanalı oluşturulurken bir hata oluştu!' });
            }
        }

        if (interaction.customId === 'close_ticket_btn') {
            await interaction.reply({ content: '🔒 Destek talebi 5 saniye içinde kapatılıyor...', ephemeral: true });
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (e) {}
            }, 5000);
        }
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
