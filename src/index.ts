import { config as dotenvconfig } from "dotenv";
dotenvconfig();

import { Client, Events, GatewayIntentBits, TextChannel, PermissionsBitField } from "discord.js";

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.MessageContent,
];

const client = new Client({ intents });

const whitelist: string[] = ["739623227189362718"];
const reporterId = "471172695862542337";

client.once(Events.ClientReady, c => {
  console.log(`Successfully logged in as ${c.user.username}`);
});

interface UserPingData {
  lastPing: Date;
  pingsTotal: number;
  flaggedMessages: [string, string][];
}

const userPinged = new Map<string, UserPingData>();
const ONE_HOUR = 60 * 60 * 1000;
const MAX_PINGS = 3;
const MUTE_DURATION = ONE_HOUR * 8;

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot || whitelist.includes(message.author.id)) return;

    const userData = userPinged.get(message.author.id) || {
      lastPing: new Date(),
      pingsTotal: 0,
      flaggedMessages: [],
    };

    // Reset if more than 1 hour has passed
    if (Date.now() - userData.lastPing.getTime() > ONE_HOUR) {
      userPinged.set(message.author.id, {
        lastPing: new Date(),
        pingsTotal: 0,
        flaggedMessages: [],
      });
      return;
    }

    if (message.mentions.roles.size > 0 || message.mentions.users.size > 0) {
      const newPings = userData.pingsTotal + 1;

      if (newPings > MAX_PINGS) {
        // Check if bot has permission to timeout members
        const member = await message.guild?.members.fetch(message.author.id);
        const botMember = await message.guild?.members.fetchMe();

        if (member && botMember) {
          // Check if bot has Moderate Members permission
          const hasPermission = botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers);

          // Also check if bot's role is higher than the target member
          const botHighestRole = botMember.roles.highest;
          const memberHighestRole = member.roles.highest;
          const canModerate = hasPermission && botHighestRole.position > memberHighestRole.position;

          if (canModerate) {
            try {
              await member.timeout(MUTE_DURATION, "Excessive mentions");
              await message.channel.send(
                `<@${message.author.id}> You have sent a large number of mentions in a short time. You have been muted for 8 hours.`
              );
            } catch (timeoutError) {
              console.error("Failed to timeout user:", timeoutError);
              await message.channel.send(
                `<@${message.author.id}> You have sent a large number of mentions in a short time. Please slow down! (Auto-mute failed - check bot permissions)`
              );
            }
          } else {
            // Bot can't timeout, just warn
            await message.channel.send(
              `<@${message.author.id}> You have sent a large number of mentions in a short time. Please slow down! (Bot lacks permission to mute)`
            );
          }
        }

        // Report to admin (even if timeout fails)
        try {
          const admin = await message.guild?.members.fetch(reporterId);
          if (admin) {
            const dm = await admin.createDM(true);
            await dm.send(
              `⚠️ Excessive mentions detected from ${message.author.username} (<@${message.author.id}>)`
            );
            await dm.send({
              content: `\`${message.content}\``,
              files: [...message.attachments.values()],
            });

            // Send flagged messages
            if (userData.flaggedMessages.length > 0) {
              for (const [channelId, msgId] of userData.flaggedMessages) {
                try {
                  const flaggedChannel = (await message.guild?.channels.fetch(
                    channelId
                  )) as TextChannel;
                  if (flaggedChannel) {
                    const flaggedMessage = await flaggedChannel.messages.fetch(msgId);
                    await dm.send({
                      content: `\`${flaggedMessage.content}\``,
                      files: [...flaggedMessage.attachments.values()],
                    });
                    if (flaggedMessage.deletable) {
                      await flaggedMessage.delete();
                    }
                  }
                } catch (err) {
                  console.error(`Failed to fetch flagged message ${msgId}:`, err);
                }
              }
              await dm.send("End of Flagged content");
            }
          }
        } catch (dmError) {
          console.error("Failed to send admin report:", dmError);
        }

        // Delete the offending message
        try {
          if (message.deletable) {
            await message.delete();
          }
        } catch (deleteError) {
          console.error("Failed to delete message:", deleteError);
        }

        // Clean up user data
        userPinged.delete(message.author.id);
      } else {
        // Track the ping
        userData.flaggedMessages.push([message.channel.id, message.id]);
        userData.pingsTotal = newPings;
        userData.lastPing = new Date();
        userPinged.set(message.author.id, userData);
      }
    }
  } catch (error) {
    console.error("Error processing message:", error);
  }
});

client.login(process.env.TOKEN);