const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// Configuration du bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates  // AJOUT CRUCIAL pour détecter les connexions vocales
    ]
});

// Garder le service éveillé (optionnel)
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Discord actif !');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Serveur web actif sur le port ${PORT}`);
});

// Gestion des erreurs pour éviter les crashes
process.on('unhandledRejection', (error) => {
    console.error('❌ Erreur non gérée (Promise):', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exception non capturée:', error);
    // Ne pas redémarrer immédiatement, Render s'en chargera
});

// Heartbeat pour surveiller la santé du bot
setInterval(() => {
    if (client.isReady()) {
        console.log(`✅ [${new Date().toISOString()}] Bot actif - Ping: ${client.ws.ping}ms`);
    }
}, 5 * 60 * 1000); // Toutes les 5 minutes

// Stockage temporaire des rôles sauvegardés
const savedRoles = new Map();

// Définition des commandes slash
const commands = [
    new SlashCommandBuilder()
        .setName('prison')
        .setDescription('Met un utilisateur en prison temporairement et le déplace vers un salon')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à mettre en prison')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Le rôle de prisonnier à attribuer')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('duree')
                .setDescription('Durée d\'emprisonnement en minutes')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1440)) // Max 24h
        .addChannelOption(option =>
            option.setName('salon')
                .setDescription('Salon vocal de prison où déplacer l\'utilisateur (optionnel)')
                .setRequired(false)
                .addChannelTypes(2)) // Type 2 = Voice Channel
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
        .setName('liberer')
        .setDescription('Libère un utilisateur de prison et restaure ses rôles originaux')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à libérer de prison')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
        .setName('prisonhelp')
        .setDescription('Affiche l\'aide pour les commandes de prison')
];

// Événement de connexion du bot
client.once('ready', async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    
    // Enregistrer les commandes slash
    try {
        console.log('Enregistrement des commandes slash...');
        await client.application.commands.set(commands);
        console.log('✅ Commandes slash enregistrées avec succès !');
    } catch (error) {
        console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
    }
});

// Gestion des interactions (slash commands)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'prison') {
            await handlePrisonCommand(interaction);
        } else if (commandName === 'liberer') {
            await handleLiberationCommand(interaction);
        } else if (commandName === 'prisonhelp') {
            await handleHelpCommand(interaction);
        }
    } catch (error) {
        console.error('Erreur lors de l\'exécution de la commande:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erreur')
            .setDescription('Une erreur est survenue lors de l\'exécution de la commande.')
            .setTimestamp();

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// Fonction pour gérer la commande prison
async function handlePrisonCommand(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('utilisateur');
    const prisonRole = interaction.options.getRole('role');
    const duration = interaction.options.getInteger('duree');
    const prisonChannel = interaction.options.getChannel('salon');

    // Obtenir le membre cible avec un fetch forcé pour avoir les dernières données vocales
    const targetMember = await interaction.guild.members.fetch({
        user: targetUser.id,
        force: true // Force le refresh des données du membre
    });
    
    if (!targetMember) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erreur')
            .setDescription('Utilisateur non trouvé dans ce serveur.')
            .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
    }

    // Vérifier si l'utilisateur est déjà en prison
    if (savedRoles.has(targetUser.id)) {
        const embed = new EmbedBuilder()
            .setColor('#FF6B00')
            .setTitle('⚠️ Déjà emprisonné')
            .setDescription('Cet utilisateur est déjà en prison.')
            .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
    }

    // Vérifier que le bot peut gérer ce rôle de prison
    const botMember = interaction.guild.members.me;
    if (prisonRole.position >= botMember.roles.highest.position) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erreur de permissions')
            .setDescription('Je ne peux pas attribuer ce rôle de prison car il est au même niveau ou au-dessus de mon rôle le plus élevé.')
            .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
    }

    // Vérifier les permissions vocales si un salon de prison est spécifié
    if (prisonChannel) {
        const botPermissions = prisonChannel.permissionsFor(botMember);
        if (!botPermissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers])) {
            const missingPerms = [];
            if (!botPermissions.has(PermissionFlagsBits.Connect)) missingPerms.push('Se connecter');
            if (!botPermissions.has(PermissionFlagsBits.MoveMembers)) missingPerms.push('Déplacer des membres');
            
            const embed = new EmbedBuilder()
                .setColor('#FF6B00')
                .setTitle('⚠️ Permissions vocales manquantes')
                .setDescription(`Je n'ai pas les permissions nécessaires dans ${prisonChannel.name} :\n• ${missingPerms.join('\n• ')}\n\nL'emprisonnement se fera sans déplacement vocal.`)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            return;
        }
    }

    // Sauvegarder les informations actuelles
    const currentRoles = targetMember.roles.cache
        .filter(role => role.id !== interaction.guild.roles.everyone.id)
        .map(role => role.id);
    
    const originalVoiceChannel = targetMember.voice.channel;

    // Debug : Afficher l'état vocal actuel
    console.log(`État vocal de ${targetUser.tag}:`, {
        isConnected: !!targetMember.voice.channel,
        channelName: targetMember.voice.channel?.name || 'Aucun',
        channelId: targetMember.voice.channel?.id || 'Aucun'
    });

    try {
        // Supprimer tous les rôles actuels
        await targetMember.roles.remove(currentRoles);

        // Ajouter le rôle de prison
        await targetMember.roles.add(prisonRole);

        // Déplacer vers le salon de prison si spécifié et si l'utilisateur est connecté
        let voiceActionMessage = '';
        if (prisonChannel) {
            if (targetMember.voice.channel) {
                // Vérifier les permissions sur le canal de prison
                const botPermissions = prisonChannel.permissionsFor(botMember);
                if (botPermissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers])) {
                    try {
                        await targetMember.voice.setChannel(prisonChannel);
                        voiceActionMessage = `\n🏛️ **Déplacé en prison vocale :** ${prisonChannel.name}`;
                    } catch (voiceError) {
                        console.error('Erreur lors du déplacement vers la prison:', voiceError);
                        if (voiceError.code === 50013) {
                            voiceActionMessage = `\n❌ **Permissions insuffisantes** pour déplacer vers ${prisonChannel.name}`;
                        } else {
                            voiceActionMessage = `\n⚠️ **Erreur de déplacement :** ${voiceError.message}`;
                        }
                    }
                } else {
                    voiceActionMessage = `\n❌ **Permissions manquantes** dans ${prisonChannel.name} (Connect/Move Members)`;
                }
            } else {
                voiceActionMessage = `\n📢 **Prison vocale :** ${prisonChannel.name} (utilisateur non connecté en vocal)`;
            }
        } else {
            // Afficher l'état vocal actuel même sans déplacement
            if (targetMember.voice.channel) {
                voiceActionMessage = `\n🎤 **Actuellement en vocal dans :** ${targetMember.voice.channel.name}`;
            } else {
                voiceActionMessage = `\n📵 **État vocal :** Non connecté`;
            }
        }

        // Sauvegarder les informations pour la restauration
        savedRoles.set(targetUser.id, {
            originalRoles: currentRoles,
            originalVoiceChannel: originalVoiceChannel,
            guildId: interaction.guild.id,
            startTime: Date.now(),
            duration: duration
        });

        // Créer l'embed de confirmation d'emprisonnement
        const successEmbed = new EmbedBuilder()
            .setColor('#FF6B00')
            .setTitle('🔒 Utilisateur emprisonné !')
            .setDescription(`**Prisonnier :** ${targetUser.tag}\n**Rôle de prison :** ${prisonRole.name}\n**Durée d'emprisonnement :** ${duration} minute(s)${voiceActionMessage}\n🔄 **Libération automatique prévue**`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: `Emprisonné par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        await interaction.editReply({ embeds: [successEmbed] });

        // Programmer la libération automatique
        setTimeout(async () => {
            await liberateUser(targetUser.id, interaction.guild, interaction.channel);
        }, duration * 60 * 1000);

    } catch (error) {
        console.error('Erreur lors de la modification des rôles:', error);
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erreur')
            .setDescription(`Impossible d'emprisonner l'utilisateur. Erreur : ${error.message}`)
            .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }
}

// Fonction pour gérer la commande de libération
async function handleLiberationCommand(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('utilisateur');
    const result = await liberateUser(targetUser.id, interaction.guild);

    const embed = new EmbedBuilder()
        .setTimestamp()
        .setFooter({ text: `Libéré par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

    if (result) {
        embed.setColor('#00FF00')
            .setTitle('🔓 Utilisateur libéré')
            .setDescription(`${targetUser.tag} a été libéré de prison et ses rôles originaux ont été restaurés !`)
            .setThumbnail(targetUser.displayAvatarURL());
    } else {
        embed.setColor('#FF6B00')
            .setTitle('⚠️ Pas en prison')
            .setDescription(`${targetUser.tag} n'est actuellement pas en prison.`);
    }

    await interaction.editReply({ embeds: [embed] });
}

// Fonction pour gérer la commande d'aide
async function handleHelpCommand(interaction) {
    const helpEmbed = new EmbedBuilder()
        .setColor('#FF6B00')
        .setTitle('🏛️ Aide - Système de Prison')
        .setDescription('Voici les commandes disponibles pour le système de prison :')
        .addFields(
            {
                name: '🔒 `/prison`',
                value: '• **Usage :** `/prison utilisateur:[user] role:[prison-role] duree:[minutes] salon:[prison-voice]`\n• **Description :** Retire tous les rôles d\'un utilisateur et l\'envoie en prison temporairement\n• **Exemple :** `/prison @Troublemaker @Prisonnier 30 #cellule-vocale`',
                inline: false
            },
            {
                name: '🔓 `/liberer`',
                value: '• **Usage :** `/liberer utilisateur:[user]`\n• **Description :** Libère manuellement un utilisateur de prison\n• **Exemple :** `/liberer @Troublemaker`',
                inline: false
            },
            {
                name: '📚 `/prisonhelp`',
                value: '• **Description :** Affiche cette aide',
                inline: false
            },
            {
                name: '⚠️ Permissions requises',
                value: 'Vous devez avoir la permission **"Gérer les rôles"** pour utiliser ces commandes.',
                inline: false
            },
            {
                name: '📝 Notes importantes',
                value: '• Le bot doit avoir un rôle plus élevé que ceux qu\'il gère\n• Un seul emprisonnement par utilisateur à la fois\n• Durée maximum : 24 heures (1440 minutes)\n• Le bot détecte automatiquement si l\'utilisateur est en vocal\n• Libération automatique à la fin de la durée',
                inline: false
            }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: `Demandé par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

    await interaction.reply({ embeds: [helpEmbed] });
}

// Fonction pour libérer un utilisateur de prison
async function liberateUser(userId, guild, notificationChannel = null) {
    const roleData = savedRoles.get(userId);
    
    if (!roleData) {
        console.log(`Aucun emprisonnement trouvé pour l'utilisateur ${userId}`);
        return false;
    }

    try {
        // Obtenir le membre avec un fetch forcé
        const member = await guild.members.fetch({
            user: userId,
            force: true
        });
        
        if (!member) {
            console.log(`Membre ${userId} non trouvé dans le serveur`);
            savedRoles.delete(userId);
            return false;
        }

        // Supprimer tous les rôles actuels (excluant @everyone)
        const currentRoles = member.roles.cache
            .filter(role => role.id !== guild.roles.everyone.id)
            .map(role => role.id);
        
        if (currentRoles.length > 0) {
            await member.roles.remove(currentRoles);
        }

        // Restaurer les rôles originaux
        const validRoles = [];
        for (const roleId of roleData.originalRoles) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                validRoles.push(role);
            }
        }

        if (validRoles.length > 0) {
            await member.roles.add(validRoles);
        }

        // Restaurer le salon vocal original si l'utilisateur est toujours en vocal
        let voiceRestoreMessage = '';
        if (roleData.originalVoiceChannel && member.voice.channel) {
            try {
                const originalChannel = guild.channels.cache.get(roleData.originalVoiceChannel.id);
                if (originalChannel) {
                    // Vérifier les permissions avant de déplacer
                    const botMember = guild.members.me;
                    const botPermissions = originalChannel.permissionsFor(botMember);
                    
                    if (botPermissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers])) {
                        await member.voice.setChannel(originalChannel);
                        voiceRestoreMessage = `\n🔊 **Replacé dans :** ${originalChannel.name}`;
                    } else {
                        voiceRestoreMessage = `\n❌ **Permissions insuffisantes** pour replacer dans ${originalChannel.name}`;
                    }
                } else {
                    voiceRestoreMessage = `\n⚠️ **Canal vocal original introuvable**`;
                }
            } catch (voiceError) {
                console.error('Erreur lors de la restauration vocale:', voiceError);
                if (voiceError.code === 50013) {
                    voiceRestoreMessage = `\n❌ **Permissions insuffisantes** pour la restauration vocale`;
                } else {
                    voiceRestoreMessage = `\n⚠️ **Impossible de replacer en vocal :** ${voiceError.message}`;
                }
            }
        } else if (roleData.originalVoiceChannel && !member.voice.channel) {
            voiceRestoreMessage = `\n📵 **L'utilisateur n'est plus en vocal**`;
        }

        // Supprimer la sauvegarde
        savedRoles.delete(userId);

        // Envoyer une notification si un canal est fourni
        if (notificationChannel) {
            const liberationEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🔓 Libération automatique')
                .setDescription(`${member.user.tag} a été automatiquement libéré de prison.${voiceRestoreMessage}`)
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();
            
            try {
                await notificationChannel.send({ embeds: [liberationEmbed] });
            } catch (error) {
                console.log('Impossible d\'envoyer la notification de libération:', error.message);
            }
        }

        console.log(`${member.user.tag} libéré de prison`);
        return true;

    } catch (error) {
        console.error(`Erreur lors de la libération de prison pour ${userId}:`, error);
        return false;
    }
}

// Événement pour détecter les changements d'état vocal (optionnel, pour debug)
client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.member.user.bot) return;
    
    console.log(`[VOCAL] ${newState.member.user.tag}:`);
    console.log(`  Ancien canal: ${oldState.channel?.name || 'Aucun'}`);
    console.log(`  Nouveau canal: ${newState.channel?.name || 'Aucun'}`);
});

// Compatibilité avec les commandes textuelles (optionnel)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Réponse pour rediriger vers les slash commands
    if (
        message.content.startsWith('!prison') ||
        message.content.startsWith('!liberer') ||
        message.content.startsWith('!prisonhelp')
    ) {
        const embed = new EmbedBuilder()
            .setColor('#FF6B00')
            .setTitle('🏛️ Système de Prison !')
            .setDescription('Ce bot utilise maintenant les **commandes slash** !\n\nTapez `/` dans le chat et cherchez mes commandes :\n• `/prison`\n• `/liberer`\n• `/prisonhelp`\n\n✨ **Avantages :** Autocomplétion, validation automatique, interface plus claire !')
            .setTimestamp();
        
        message.reply({ embeds: [embed] });
    }
});

// Gestion des erreurs
client.on('error', console.error);

// Remplacez par votre token
client.login(process.env.TOKEN);