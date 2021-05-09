import {chromiumArgs, clientsArray, sessions} from "./sessionUtil";
import {create, SocketState, tokenStore} from "@wppconnect-team/wppconnect";
import fs from "fs";
import {download} from "../controller/SessionController";
import {callWebHook} from "./functions";

export async function openAllSessions(session) {
    await createSessionUtil(clientsArray, session);
}

async function createSessionUtil(clientsArray, session) {
    try {
        let client = getClient(session);
        if (client.status != null)
            return;
        client.status = "INITIALIZING";
        client.webhook = process.env.WEBHOOK_URL;

        let myTokenStore = new tokenStore.FileTokenStore({
            encodeFunction: (data) => {
                return encodeFunction(data, process.env.WEBHOOK_URL);
            }
        });

        let wppClient = await create(
            {
                session: session,
                headless: true,
                devtools: false,
                useChrome: true,
                debug: false,
                logQR: true,
                browserArgs: chromiumArgs,
                refreshQR: 15000,
                disableSpins: true,
                tokenStore: myTokenStore,
                catchQR: (base64Qr, asciiQR) => {
                    exportQR(base64Qr, client);
                },
                statusFind: (statusFind) => {
                    console.log(statusFind + '\n\n')
                }
            });

        client = clientsArray[session] = Object.assign(wppClient, client);
        await start(client);
        sessions.push({session: session});
    } catch (e) {
        console.log("error create -> ", e);
    }
}

function encodeFunction(data, webhook) {
    data.webhook = webhook;
    return JSON.stringify(data);
}

function exportQR(qrCode, client) {
    Object.assign(client, {status: 'QRCODE', qrcode: qrCode});

    qrCode = qrCode.replace('data:image/png;base64,', '');
    const imageBuffer = Buffer.from(qrCode, 'base64');

    fs.writeFileSync(`${client.session}.png`, imageBuffer);
    callWebHook(client, "qrcode", {qrcode: qrCode});
}

async function start(client) {
    try {
        await client.isConnected();
        Object.assign(client, {status: 'CONNECTED'});

        console.log(`Started Session: ${client.session}`);
    } catch (error) {
        console.log(`Error Session: ${client.session}`);
    }

    await checkStateSession(client);
    await listenMessages(client);
    await listenAcks(client);
}

async function checkStateSession(client) {
    await client.onStateChange((state) => {
        console.log(`State Change ${state}: ${client.session}`);
        const conflits = [
            SocketState.CONFLICT,
        ];

        if (conflits.includes(state)) {
            client.useHere();
        }
    });
}

async function listenMessages(client) {
    await client.onMessage(async (message) => {
        try {
            await callWebHook(client, "onmessage", message)
        } catch (e) {
            console.log("A URL do Webhook não foi informado.");
        }
    });

    await client.onAnyMessage((message) => {
        message.session = client.session;

        if (message.type === "sticker") {
            download(message, client.session);
        }
    });
}

async function listenAcks(client) {
    await client.onAck(async (ack) => {
        try {
            await callWebHook(client, "onack", {ack: ack})
        } catch (e) {
            console.log("A URL do Webhook não foi informado.");
        }
    });
}

function getClient(session) {
    let client = clientsArray[session];

    if (!client)
        client = clientsArray[session] = {status: null, session: session};
    return client;
}