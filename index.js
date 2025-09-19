// index.js
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');
const express = require("express");

const DATA_FILE = path.join(__dirname, 'data.json');




// ================== CONFIG ==================
let STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const HEADADMIN_ROLE_ID = process.env.HEADADMIN_ROLE_ID;
const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID;
const TOKEN = process.env.DISCORD_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;

if (!TOKEN || !STAFF_ROLE_ID || !ADMIN_ROLE_ID || !HEADADMIN_ROLE_ID || !OWNER_ROLE_ID) {
  console.error('❌ Faltan variables de entorno.');
  process.exit(1);
}

// ================== XP CONFIG ==================
const THRESHOLDS = { 1:0, 2:2000, 3:3500 };
const XP_PER_MESSAGE = 2;
const XP_PER_ECONOMY_COMMAND = 15;
const ECON_COMMANDS = ['.balance', '.bal', '.work', '.worn', '.pay', 'Klk'];
const XP_VOICE = 5;
const XP_VOICE_INTERVAL = 30 * 1000;
const XP_DELETE = 10;

const voiceTimers = new Map();

// ================== FUNCIONES UTILIDAD ==================
async function loadData() {
  if (!(await fs.pathExists(DATA_FILE))) {
    await fs.writeJSON(DATA_FILE, { users:{}, blacklist:{} }, { spaces:2 });
  }
  return await fs.readJSON(DATA_FILE);
}
async function saveData(data) {
  await fs.writeJSON(DATA_FILE, data, { spaces:2 });
}
async function ensureUser(data, guildId, userId) {
  const key = `${guildId}_${userId}`;
  if (!data.users[key]) data.users[key] = { xp:0, level:1, lastMessage:0 };
  return data.users[key];
}
function xpToLevel(xp) {
  if (xp>=THRESHOLDS[3]) return 3;
  if (xp>=THRESHOLDS[2]) return 2;
  return 1;
}
function buildProgressBar(currentXp, fromThreshold, toThreshold, length=12){
  const total = Math.max(1, toThreshold - fromThreshold);
  const progress = Math.min(total, Math.max(0, currentXp - fromThreshold));
  const filled = Math.round((progress/total)*length);
  const bar = '█'.repeat(filled)+'░'.repeat(length-filled);
  const percent = Math.round((progress/total)*100);
  return { bar, percent };
}
async function logAction(client, guild, message){
  if(!LOG_CHANNEL_ID) return;
  try {
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if(channel) await channel.send(message);
  } catch(e){ console.error("Error enviando log:", e); }
}
function hasStaffPerm(member){
  return (
    member.roles.cache.has(STAFF_ROLE_ID) ||
    member.roles.cache.has(ADMIN_ROLE_ID) ||
    member.roles.cache.has(HEADADMIN_ROLE_ID) ||
    member.roles.cache.has(OWNER_ROLE_ID)
  );
}

// ================== CLIENT ==================
const client = new Client({ intents:[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates
]});

client.once(Events.ClientReady, ()=>console.log(`✅ ${client.user.tag} listo!`));

// ================== MENSAJES ==================
client.on(Events.MessageCreate, async (message)=>{
  if(message.author.bot || !message.guild) return;
  const member = message.member;
  const data = await loadData();
  const rec = await ensureUser(data, message.guild.id, message.author.id);

  const content = message.content.trim();

  // ---- XP STAFF por mensaje y comandos ----
  if(member.roles.cache.has(STAFF_ROLE_ID)){
    const now = Date.now();
    if(now-(rec.lastMessage||0)>=5000){
      rec.xp += XP_PER_MESSAGE;
      rec.lastMessage = now;
    }
    for(const cmd of ECON_COMMANDS){
      if(content.toLowerCase().startsWith(cmd)) rec.xp += XP_PER_ECONOMY_COMMAND;
    }

    const oldLevel = rec.level;
    const newLevel = xpToLevel(rec.xp);
    rec.level = newLevel;

    if(newLevel>oldLevel){
      if(newLevel===2) await member.roles.add(ADMIN_ROLE_ID).catch(()=>{});
      else if(newLevel===3) await member.roles.add(HEADADMIN_ROLE_ID).catch(()=>{});

      const embed = new EmbedBuilder()
        .setTitle('🎉 ¡Promoción automática!')
        .setDescription(`<@${member.id}> subió al nivel **${newLevel}**`)
        .addFields(
          { name:'XP total', value:`${rec.xp}`, inline:true },
          { name:'Nuevo rol', value:newLevel===2?`<@&${ADMIN_ROLE_ID}>`:`<@&${HEADADMIN_ROLE_ID}>`, inline:true }
        )
        .setTimestamp();
      await message.channel.send({ embeds:[embed] });
      await logAction(client,message.guild,`📈 ${member.user.tag} subió a nivel ${newLevel}`);
    }
  }

  await saveData(data);

  // ---- COMANDOS ----
  if(!content.startsWith('!')) return;
  const args = content.slice(1).split(/\s+/);
  const cmd = args.shift().toLowerCase();

  

  // !perfil-staff @user
  if(cmd==='perfil-staff'){
    const target = message.mentions.members.first();
    if(!target) return message.reply('Menciona a un usuario.');
    if(!hasStaffPerm(member)) return message.reply('No tienes permiso.');

    const key = `${message.guild.id}_${target.id}`;
    const urec = data.users[key]||{xp:0,level:1};
    let from = THRESHOLDS[urec.level];
    let to = THRESHOLDS[urec.level+1]||THRESHOLDS[3]+200;
    const { bar, percent } = buildProgressBar(urec.xp, from, to);

    const embed = new EmbedBuilder()
      .setTitle(`📋 Perfil de ${target.user.tag}`)
      .addFields(
        { name:'Nivel', value:`${urec.level}`, inline:true },
        { name:'XP', value:`${urec.xp}/${to}`, inline:true },
        { name:'Progreso', value:`${bar} ${percent}%`, inline:false },
        { name:'Roles', value:target.roles.cache.map(r=>r.toString()).join(', ') }
      )
      .setTimestamp();
    return message.channel.send({ embeds:[embed] });
  }

  // !remove-staff @user
  if(cmd==='remove-staff'){
    if(!member.roles.cache.has(OWNER_ROLE_ID)) return message.reply('Solo Owner puede usarlo.');
    const target = message.mentions.members.first();
    if(!target) return message.reply('Menciona a un usuario.');
    await target.roles.remove(STAFF_ROLE_ID).catch(()=>{});
    await target.roles.remove(ADMIN_ROLE_ID).catch(()=>{});
    await target.roles.remove(HEADADMIN_ROLE_ID).catch(()=>{});

    const key = `${message.guild.id}_${target.id}`;
    if(data.users[key]) { data.users[key].xp=0; data.users[key].level=1; }
    await saveData(data);
    await message.channel.send(`Se removió Staff y roles superiores a ${target.user.tag}`);
    await logAction(client,message.guild,`🛑 ${target.user.tag} removido como staff por ${member.user.tag}`);
  }

  // !set-staff-role <roleId>
  if(cmd==='set-staff-role'){
    if(!member.roles.cache.has(OWNER_ROLE_ID)) return message.reply('Solo Owner puede usarlo.');
    const newId = args[0];
    if(!newId) return message.reply('Debes poner un roleId.');
    STAFF_ROLE_ID = newId;
    await message.channel.send(`Staff Role cambiado a <@&${STAFF_ROLE_ID}> (runtime)`);
    await logAction(client,message.guild,`🔧 Staff role cambiado a ${STAFF_ROLE_ID} por ${member.user.tag}`);
  }

  // ---- BLACKLIST ----
  if(['add-blacklist','agregar-blacklist','add-black','añadir-blacklist'].includes(cmd)){
    if(!hasStaffPerm(member)) return message.reply('No tienes permiso.');
    const targetId = args[0];
    if(!targetId) return message.reply('Uso: !add-blacklist <userId> [razón]');
    const reason = args.slice(1).join(' ') || 'Sin razón especificada';
    const userId = targetId.replace(/[<@!>]/g,'');
    if(!/^\d{17,19}$/.test(userId)) return message.reply('ID inválido.');

    if(!data.blacklist[userId]) {
      data.blacklist[userId] = { reason, addedBy: message.author.id, addedAt: new Date().toISOString(), bannedIn: {} };
    }
    data.blacklist[userId].bannedIn[message.guild.id] = true;
    await saveData(data);

    try{
      const guildMember = await message.guild.members.fetch(userId).catch(()=>null);
      if(guildMember){
        await message.guild.members.ban(userId, { reason: `Blacklist añadida: ${reason}` }).catch(()=>{});
      }
    }catch(e){ console.error("Error banneando usuario:", e); }

    await logAction(client, message.guild, `⛔ Usuario ${userId} añadido a blacklist por ${message.author.tag}. Razón: ${reason}`);
    return message.channel.send(`✅ Usuario <@${userId}> agregado a blacklist. Razón: ${reason}`);
  }

  if(['eliminar-blacklist','remove-blacklist','del-blacklist'].includes(cmd)){
    if(!hasStaffPerm(member)) return message.reply('No tienes permiso.');
    const targetId = args[0];
    if(!targetId) return message.reply('Uso: !eliminar-blacklist <userId>');
    const userId = targetId.replace(/[<@!>]/g,'');
    if(!data.blacklist[userId]) return message.reply('Ese usuario no está en blacklist.');

    if(data.blacklist[userId].bannedIn && data.blacklist[userId].bannedIn[message.guild.id]) {
      delete data.blacklist[userId].bannedIn[message.guild.id];
    }
    const remaining = Object.keys(data.blacklist[userId].bannedIn||{}).length;
    if(remaining===0) delete data.blacklist[userId];

    await saveData(data);
    await message.channel.send(`✅ Usuario removido de blacklist.`);
    await logAction(client, message.guild, `♻️ Usuario ${userId} removido de blacklist por ${member.user.tag}`);
  }

  if(['lista-blacklist','list-blacklist','blacklist'].includes(cmd)){
    if(!hasStaffPerm(member)) return message.reply('No tienes permiso.');
    const entries = Object.entries(data.blacklist||{}).filter(([uid,info]) => info.bannedIn && info.bannedIn[message.guild.id]);
    if(entries.length===0) return message.channel.send('No hay usuarios en blacklist.');

    const embed = new EmbedBuilder().setTitle('📛 Blacklist en este servidor').setTimestamp();
    const toShow = entries.slice(0,20);
    const fetches = toShow.map(([uid]) => client.users.fetch(uid).catch(()=>null));
    const fetched = await Promise.all(fetches);

    toShow.forEach(([uid, info], i) => {
      const u = fetched[i];
      const name = u ? `${u.tag}` : `ID: ${uid}`;
      const guildCount = Object.keys(info.bannedIn||{}).length;
      embed.addFields({
        name: name,
        value: `ID: ${uid}\nRazón: ${info.reason}\nAñadido por: <@${info.addedBy}>\nFecha: ${new Date(info.addedAt).toLocaleString()}\nBaneado en ${guildCount} servidor(es).`,
        inline:false
      });
    });
    return message.channel.send({ embeds:[embed] });
  }
});

// ================== XP por eliminar mensajes ==================
client.on(Events.MessageDelete, async (message)=>{
  if(!message.guild || !message.member) return;
  const member = message.member;
  if(member.user.bot || !member.roles.cache.has(STAFF_ROLE_ID)) return;

  const data = await loadData();
  const rec = await ensureUser(data, message.guild.id, member.id);

  rec.xp += XP_DELETE;
  const oldLevel = rec.level;
  const newLevel = xpToLevel(rec.xp);
  rec.level = newLevel;
  await saveData(data);

  if(newLevel>oldLevel){
    if(newLevel===2) await member.roles.add(ADMIN_ROLE_ID).catch(()=>{});
    else if(newLevel===3) await member.roles.add(HEADADMIN_ROLE_ID).catch(()=>{});

    const embed = new EmbedBuilder()
      .setTitle('🎉 ¡Promoción automática por actividad!')
      .setDescription(`<@${member.id}> subió al nivel **${newLevel}**`)
      .setTimestamp();
    const channel = message.guild.systemChannel || message.guild.channels.cache.find(c => c.isTextBased());
    if(channel) await channel.send({ embeds:[embed] });
    await logAction(client, message.guild, `📈 ${member.user.tag} subió a nivel ${newLevel} (delete)`);
  }
});

// ================== XP por estar en voice ==================
client.on('voiceStateUpdate', async (oldState,newState)=>{
  const member = newState.member;
  if(!member || member.user.bot || !member.roles.cache.has(STAFF_ROLE_ID)) return;

  const data = await loadData();
  const rec = await ensureUser(data, member.guild.id, member.id);

  if(!oldState.channel && newState.channel){
    if(!voiceTimers.has(member.id)){
      const interval = setInterval(async ()=>{
        rec.xp += XP_VOICE;
        const oldLevel = rec.level;
        const newLevel = xpToLevel(rec.xp);
        rec.level = newLevel;
        await saveData(data);

        if(newLevel>oldLevel){
          if(newLevel===2) await member.roles.add(ADMIN_ROLE_ID).catch(()=>{});
          else if(newLevel===3) await member.roles.add(HEADADMIN_ROLE_ID).catch(()=>{});
          const embed = new EmbedBuilder()
            .setTitle('🎉 ¡Promoción automática por voice!')
            .setDescription(`<@${member.id}> subió al nivel **${newLevel}**`)
            .setTimestamp();
          const channel = member.guild.systemChannel || member.guild.channels.cache.find(c => c.isTextBased());
          if(channel) await channel.send({ embeds:[embed] });
          await logAction(client, member.guild, `📈 ${member.user.tag} subió a nivel ${newLevel} (voice)`);
        }
      }, XP_VOICE_INTERVAL);
      voiceTimers.set(member.id, interval);
    }
  } else if(oldState.channel && !newState.channel){
    const interval = voiceTimers.get(member.id);
    if(interval){ clearInterval(interval); voiceTimers.delete(member.id); }
  }
});

// ================== ANTI-RAID ==================
client.on("guildMemberAdd", async member=>{
  if(member.user.bot){
    try{
      if(!member.user.flags?.has("VerifiedBot")){
        await member.ban({reason:"Bot no verificado"});
        await logAction(client, member.guild, `🚨 Bot baneado: ${member.user.tag}`);
      }
    }catch(e){console.error(e);}
  }
});

// ================== KEEP ALIVE ==================
const app = express();
app.get("/server.js",(req,res)=>res.send("Bot corriendo ✅"));
app.listen(3000,()=>console.log("🌐 Servidor web encendido en el puerto 3000"));

// ================== LOGIN ==================
client.login(TOKEN);
