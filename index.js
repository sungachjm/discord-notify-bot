require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  MessageFlags,
} = require('discord.js');

// Màu #2b2d31 trùng nền dark mode của Discord -> embed nhìn như "trong suốt"
const TRANSPARENT = 0x2b2d31;

const COLORS = {
  transparent: TRANSPARENT,
  red: 0xed4245,
  green: 0x57f287,
  blue: 0x5865f2,
  yellow: 0xfee75c,
  purple: 0x9b59b6,
};

const colorChoices = [
  { name: 'Trong suốt (mặc định)', value: 'transparent' },
  { name: 'Đỏ', value: 'red' },
  { name: 'Xanh lá', value: 'green' },
  { name: 'Xanh dương', value: 'blue' },
  { name: 'Vàng', value: 'yellow' },
  { name: 'Tím', value: 'purple' },
];

// ---------- Slash command definitions ----------
const commands = [
  new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Gửi thông báo dạng embed')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('send')
        .setDescription('Gửi thông báo vào một kênh')
        .addStringOption((o) =>
          o.setName('title').setDescription('Tiêu đề').setRequired(true).setMaxLength(256),
        )
        .addStringOption((o) =>
          o
            .setName('description')
            .setDescription('Nội dung (gõ \\n để xuống dòng)')
            .setRequired(true)
            .setMaxLength(4000),
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Kênh gửi (mặc định: kênh hiện tại)'),
        )
        .addAttachmentOption((o) => o.setName('image').setDescription('Hình ảnh trong embed'))
        .addStringOption((o) =>
          o.setName('color').setDescription('Màu embed').addChoices(...colorChoices),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Role cần ping'))
        .addStringOption((o) =>
          o.setName('footer').setDescription('Chữ nhỏ ở cuối embed').setMaxLength(2048),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Xem trước thông báo (chỉ mình bạn thấy)')
        .addStringOption((o) =>
          o.setName('title').setDescription('Tiêu đề').setRequired(true).setMaxLength(256),
        )
        .addStringOption((o) =>
          o
            .setName('description')
            .setDescription('Nội dung (gõ \\n để xuống dòng)')
            .setRequired(true)
            .setMaxLength(4000),
        )
        .addAttachmentOption((o) => o.setName('image').setDescription('Hình ảnh trong embed'))
        .addStringOption((o) =>
          o.setName('color').setDescription('Màu embed').addChoices(...colorChoices),
        )
        .addStringOption((o) =>
          o.setName('footer').setDescription('Chữ nhỏ ở cuối embed').setMaxLength(2048),
        ),
    ),

  // Lệnh DM tách riêng, không thuộc /notify
  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Gửi tin nhắn riêng (DM) cho một thành viên')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('user').setDescription('Người nhận').setRequired(true))
    .addStringOption((o) =>
      o.setName('title').setDescription('Tiêu đề').setRequired(true).setMaxLength(256),
    )
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription('Nội dung (gõ \\n để xuống dòng)')
        .setRequired(true)
        .setMaxLength(4000),
    )
    .addAttachmentOption((o) => o.setName('image').setDescription('Hình ảnh trong embed'))
    .addStringOption((o) =>
      o.setName('color').setDescription('Màu embed').addChoices(...colorChoices),
    ),
].map((c) => c.toJSON());

// ---------- Helpers ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/**
 * Tải ảnh về rồi upload lại cùng tin nhắn để link không bị hết hạn.
 * Trả về { file, name } hoặc null nếu không có ảnh.
 */
async function prepareImage(attachment) {
  if (!attachment) return null;
  if (!attachment.contentType?.startsWith('image/')) {
    throw new Error('NOT_IMAGE');
  }
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error('FETCH_FAILED');
  const buffer = Buffer.from(await res.arrayBuffer());
  const name = (attachment.name || 'image.png').replace(/[^\w.\-]/g, '_');
  return { file: new AttachmentBuilder(buffer, { name }), name };
}

function buildEmbed({ title, description, color, image, footer, timestamp = true }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description.replace(/\\n/g, '\n'))
    .setColor(COLORS[color] ?? TRANSPARENT);

  if (image) embed.setImage(`attachment://${image.name}`);
  if (footer) embed.setFooter({ text: footer });
  if (timestamp) embed.setTimestamp();
  return embed;
}

async function readImageOrReply(interaction) {
  try {
    return await prepareImage(interaction.options.getAttachment('image'));
  } catch (err) {
    const msg =
      err.message === 'NOT_IMAGE'
        ? '❌ File bạn gửi không phải hình ảnh.'
        : '❌ Không tải được hình ảnh, thử lại nhé.';
    await interaction.editReply({ content: msg });
    return undefined; // undefined = đã trả lời lỗi, dừng lại
  }
}

// ---------- Handlers ----------
async function handleNotify(interaction) {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const image = await readImageOrReply(interaction);
  if (image === undefined) return;

  const embed = buildEmbed({
    title: interaction.options.getString('title', true),
    description: interaction.options.getString('description', true),
    color: interaction.options.getString('color'),
    footer: interaction.options.getString('footer'),
    image,
  });
  const files = image ? [image.file] : [];

  if (sub === 'preview') {
    return interaction.editReply({ content: '👀 Bản xem trước:', embeds: [embed], files });
  }

  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const me = interaction.guild.members.me;
  const perms = channel.permissionsFor(me);

  if (!channel.isTextBased() || !perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles'])) {
    return interaction.editReply({
      content: `❌ Bot thiếu quyền (Send Messages / Embed Links / Attach Files) trong ${channel}.`,
    });
  }

  const role = interaction.options.getRole('role');
  await channel.send({
    content: role ? `${role}` : undefined,
    embeds: [embed],
    files,
    allowedMentions: role ? { roles: [role.id] } : { parse: [] },
  });

  return interaction.editReply({ content: `✅ Đã gửi thông báo vào ${channel}.` });
}

async function handleDm(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser('user', true);
  if (target.bot) {
    return interaction.editReply({ content: '❌ Không thể gửi DM cho bot.' });
  }

  const image = await readImageOrReply(interaction);
  if (image === undefined) return;

  const embed = buildEmbed({
    title: interaction.options.getString('title', true),
    description: interaction.options.getString('message', true),
    color: interaction.options.getString('color'),
    footer: `Từ ${interaction.guild.name} • ${interaction.user.username}`,
    image,
  });

  try {
    await target.send({ embeds: [embed], files: image ? [image.file] : [] });
    return interaction.editReply({ content: `✅ Đã gửi DM cho ${target}.` });
  } catch (err) {
    if (err.code === 50007) {
      return interaction.editReply({ content: '❌ Người này đã tắt DM hoặc chặn bot.' });
    }
    throw err;
  }
}

// ---------- Events ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Đăng nhập: ${c.user.tag}`);

  // Có GUILD_ID -> lệnh hiện ngay lập tức; không có -> đăng ký global (chờ tới ~1 giờ)
  if (process.env.GUILD_ID) {
    const guild = await c.guilds.fetch(process.env.GUILD_ID);
    await guild.commands.set(commands);
    console.log('📌 Đã đăng ký lệnh cho server test');
  } else {
    await c.application.commands.set(commands);
    console.log('🌍 Đã đăng ký lệnh global');
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'notify') return await handleNotify(interaction);
    if (interaction.commandName === 'dm') return await handleDm(interaction);
  } catch (err) {
    console.error(err);
    const payload = { content: '❌ Có lỗi xảy ra, thử lại sau nhé.' };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

// Server HTTP nhỏ: Render (Web Service) cần một cổng mở, và để UptimeRobot ping giữ bot thức
require('http')
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive');
  })
  .listen(process.env.PORT || 3000, () => console.log('🌐 HTTP server đang chạy'));

client.login(process.env.TOKEN);
