require('dotenv').config();
const {Client, Intents} = require('discord.js');
const {createLogger, format, transports} = require('winston');
const {combine, timestamp, printf} = format;
const fs = require('fs').promises;


if(!process.env.hasOwnProperty('DISCORD_TOKEN')) {
    console.error('No Discord token specified!');
    return;
}

const myFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});
const logger = createLogger({
    format: combine(
        timestamp(),
        myFormat
    ),
    transports: [
        new transports.Console(),
        new transports.File({filename: 'logs/bot.log'})
    ]
});
logger.info('Started logging');


const token = process.env['DISCORD_TOKEN'];

const client = new Client({ intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGE_TYPING,
    Intents.FLAGS.GUILD_MESSAGES
]});

const typingMessages = [
    'What\'s up {id}? Got something to share with the class?',
    'Oooh whatcha typing there {id}?',
    'Let\'s see that message {id} 👀',
    'Excited to see what you\'re typing out {id}',
    'Oh sorry {id}, don\'t let me interrupt you'
];
const awayMessages = [
    'Huh? Why\'d you stop?',
    'Well don\'t let me stop you',
    'No no keep going, I wanted to see what you were saying',
    'Taking a breather?',
    'Yeah, okay, let those fingers rest for a bit'
];
const backMessages = [
    'Oh? Welcome back?',
    'Come back to finish what you started?',
    'Good to see you back on the grind',
    'Back at it again!',
    'Hopefully worth the wait'
];

function getRandomMessage(batch) {
    return batch[Math.floor(Math.random() * batch.length)];
}

const people = {};
let activeServers = null;

client.once('ready', () => {
    logger.info('Ready!');

    client.on('typingStart', async typing => {
        if(typing.user.bot) return;
        if(!activeServers.includes(typing.guild.id)) return;

        logger.info('Got typing info from ' + typing.user.toString() + ' in ' + typing.channel.id);

        const id = typing.user.id + '-' + typing.channel.id;

        let person;
        if(!people.hasOwnProperty(id)) {
            logger.info('    (first instance)');
            const content = getRandomMessage(typingMessages).replace('{id}', `${typing.user.toString()}`);
            person = {
                state: 'first-typing',
                message: await typing.channel.send(content)
            };
            people[id] = person;
        } else {
            person = people[id];

            if(person.state === 'first-pause') {
                logger.info('    (resumed)');
                person.state = 'resumed';
                let lines = person.message.content.split('\n');
                lines.push(getRandomMessage(backMessages));
                person.message.edit(lines.join('\n'));
            } else if(person.state === 'other-pause') {
                logger.info('    (second resume)');
                person.state = 'resumed';
                let lines = person.message.content.split('\n');
                lines[lines.length - 1] = lines[lines.length - 1].replaceAll('~~', '');
                person.message.edit(lines.join('\n'));
            } else {
                logger.info('    (continued)');
            }
        }

        if(person.hasOwnProperty('onStop')) {
            clearTimeout(person.onStop);
        }
        if(person.hasOwnProperty('onStale')) {
            clearTimeout(person.onStale);
        }

        person.onStop = setTimeout(() => {
            if(person.state === 'first-typing') {
                logger.info('First typing stop for ' + typing.user.toString() + ' in ' + typing.channel.id);
                person.state = 'first-pause';

                let lines = person.message.content.split('\n');
                lines.push(getRandomMessage(awayMessages));
                person.message.edit(lines.join('\n'));
            } else if(person.state === 'resumed') {
                logger.info('Other typing stop for ' + typing.user.toString() + ' in ' + typing.channel.id);
                person.state = 'other-pause';
                let lines = person.message.content.split('\n');
                lines[lines.length - 1] = '~~' + lines[lines.length - 1] + '~~';
                person.message.edit(lines.join('\n'));
            }
        }, 12 * 1000);

        person.onStale = setTimeout(() => {
            logger.info('Stale message for ' + typing.user.toString() + ' in ' + typing.channel.id);
            person.message.delete();
            delete people[id];
        }, 60 * 1000);
    });

    client.on('messageCreate', async message => {
        const id = message.author.id + '-' + message.channel.id;
        if(people.hasOwnProperty(id)) {
            const person = people[id];
            logger.info('Removing own message because ' + message.author.toString() + ' in ' + message.channel.id);

            if(person.hasOwnProperty('onStop')) {
                clearTimeout(person.onStop);
            }
            if(person.hasOwnProperty('onStale')) {
                clearTimeout(person.onStale);
            }

            person.message.delete();
            delete people[id];
        }

        if(message.mentions.has(client.user) && message.member.permissionsIn(message.channel).has('ADMINISTRATOR')) {
            logger.info('Got message from admin');
            if(message.content.includes('go') && !activeServers.includes(message.guild.id)) {
                logger.info('Starting in ' + message.guild.id);
                activeServers.push(message.guild.id);
                await message.react('📈');
            } else if(message.content.includes('stop') && activeServers.includes(message.guild.id)) {
                logger.info('Stopping in ' + message.guild.id);
                activeServers = activeServers.filter(gid => gid !== message.guild.id);
                await message.react('📉');
            } else {
                return;
            }

            await fs.writeFile('./active.json', JSON.stringify(activeServers, null, 4), 'utf-8');
        }
    });
});

(async () => {
    try {
        activeServers = JSON.parse(await fs.readFile('./active.json', 'utf-8'));
    } catch(e) {
        activeServers = [];
    }

    await client.login(token);
})();
