const puppeteer = require('puppeteer-core');
const schedule = require('node-schedule');
const config = require("./config.json");

async function doScreenies(page, list) {
    for (let i = 0; i < list.length; i++) {
        if (list[i] === "world") {
            await page.goto("https://www.worldometers.info/coronavirus/");
            await page.screenshot({ path:  config.screenshotDir+ "/world1.png", clip: { x: 400, y: 200, width: 700, height: 700 } });
            await page.evaluate(_ => {
                window.scrollBy(0, 800);
            });
            await page.screenshot({ path: config.screenshotDir+ "/world2.png", clip: { x: 400, y: 800, width: 800, height: 800 } });
        } else {
            await page.goto(`https://www.google.com/search?client=ubuntu&channel=fs&q=${list[i]}+coronavirus+total+cases&ie=utf-8&oe=utf-8`);
            await page.screenshot({ path: `${config.screenshotDir}/${list[i]}1.png`, clip: { x: 150, y: 150, width: 750, height: 630 } })
        }
    }
}

async function doUpload(page, name) {
    console.log(config.screenshotDir +"/"+ name);

    const [fileChooser] = await Promise.all([
        page.waitForFileChooser(),
        page.click("div[class='_7oan _m _6a _4q60 _3rzn']"), // some button that triggers file selection
    ]);
    await fileChooser.accept([config.screenshotDir +"/"+ name]);

}

async function makePost(page, list) {
    await page.goto(`https://www.messenger.com/t/${config.chatId}`);
    // 1. upload the images
    try {
        for (let i = 0; i < list.length; i++) {
            await doUpload(page, `${list[i]}1.png`);
            if (list[i] === "world") await doUpload(page, `${list[i]}2.png`);
        }
     } catch (e) {
         console.log("File Not Found");
         await page.goto(`https://www.messenger.com/t/${config.chatId}`);

         await makeTextPost(page, `Failed to find screenshots for \`${list}\`, use \`corona pull\` to fetch screenshots`)
    }
    // 2. submit
    await page.keyboard.down('Enter');
    await page.waitFor(50);
    await page.keyboard.up('Enter');
    await page.waitFor(350);

}

async function makeTextPost(page, text) {
    await page.keyboard.type(text, { delay: 20 });
    await doEnter(page);
}

async function doShiftEnter(page) {
    await page.keyboard.down('Shift');
    await page.keyboard.down('Enter');
    await page.waitFor(50);
    await page.keyboard.up('Shift');
    await page.keyboard.up('Enter');
}

async function doEnter(page) {
    await page.keyboard.down('Enter');
    await page.waitFor(50);
    await page.keyboard.up('Enter');
}

async function doLogin(page) {
    await page.goto(`https://www.messenger.com/t/${config.chatId}`);
    await page.waitForSelector("#email");
    await page.waitForSelector("#pass");
    await page.waitForSelector("#loginbutton");
    await page.waitFor(100);

    await page.type('#email', config.username, { delay: 50 });
    await page.type('#pass', config.password, { delay: 50 });
    await page.click('#loginbutton');
    await page.waitForNavigation({ waitUntil: 'networkidle0' })
}


(async () => {
    const browser = await puppeteer.launch({
        headless: config.headless,
        defaultViewport: {
            width: 1920,
            height: 900
        },
        executablePath:"/usr/bin/chromium-browser"
    });


    const page = await browser.newPage();
    await doLogin(page);

    let messages = [];
    let newMessages = [];
    let firstPass = true;
    let lock = false;

    // auto refresh page once every 10 minutes to avoid messags piling up
    schedule.scheduleJob('*/10 * * * *', async function () {
        let waiter = setInterval(async () => {
            if (!lock) {
                firstPass = true;
                lock = true;
                console.log('Doing refresh');
                await page.reload();
                lock = false;
                clearInterval(waiter);
            }
        }, 500)
    });

    // every day make an update
    schedule.scheduleJob({ hour: config.updateTime, minute: 0 }, async function () {

        let waiter = setInterval(async () => {
            if (!lock) {
                console.log("Automatic post")
                firstPass = true;
                lock = true;
                await makeTextPost(page, "Automatic Update for "+ new Date());
                await doScreenies(page, ["world", "canada"]);
                await makePost(page, ["world", "canada"]);
                lock = false;
                clearInterval(waiter);
            }
        }, 500)
    });

    //1. if new Messages is largar than old messages, there has been a new message
    //2. check each of the new messages if they start with !corona or !byerona
    let eventLoop = setInterval(async () => {
        if (!lock) {
            await page.waitForSelector("span[class='_3oh- _58nk']");
            let newMessageElements = await page.$$("span[class='_3oh- _58nk']");
            messages = newMessages;
            newMessages = [];
            for (let i = 0; i < newMessageElements.length; i++) {
                const text = await (await newMessageElements[i].getProperty('textContent')).jsonValue();
                newMessages.push(text);
            }

            // message processing
            if (newMessages.length > messages.length && !firstPass) {
                for (let i = messages.length; i < newMessages.length; i++) {
                    let arg = (newMessages[i].split(" ").length == 3) ? newMessages[i].split(" ")[2] : null;

                    if (newMessages[i].startsWith("!corona pull")) {
                        firstPass = true;
                        lock = true;

                        console.log("Doing fresh rona report");
                        switch (arg) {
                            case null:
                                // 1. canada + world meters
                                await doScreenies(page, ["world", "canada"]);
                                await makePost(page, ["world", "canada"]);
                                break;
                            case "world":
                                // 2. Just world meters
                                await doScreenies(page, ["world"]);
                                await makePost(page, ["world"]);
                                break;
                            default:
                                // 3. For that country
                                await doScreenies(page, [arg]);
                                await makePost(page, [arg]);
                        }
                        lock = false;

                    } else if (newMessages[i].startsWith("!corona status")) {
                        console.log("Doing stale rona report");
                        firstPass = true;
                        lock = true;

                        switch (arg) {
                            case null:
                                // 1. canada + world meters
                                await makePost(page, ["world", "canada"]);
                                break;
                            case "world":
                                // 2. Just world meters
                                await makePost(page, ["world"]);
                                break;
                            default:
                                // 3. For that country
                                await makePost(page, [arg]);
                        }
                        lock = false;
                    }

                    else if (newMessages[i] === "!corona exit") {
                        console.log("Exiting");
                        await makeTextPost(page, "Coronabot Exiting");
                        await browser.close();
                        clearInterval(eventLoop);
                    }

                    else if (newMessages[i] === "!corona") {
                        lock = true;
                        firstPass = true;
                        await makePost(page, ["world", "canada"]);
                        lock = false;
                    }

                    else if (newMessages[i] == "!corona help" || newMessages[i].startsWith("!corona")) {
                        console.log("Doing help");
                        firstPass = true;
                        lock = true;

                        await page.keyboard.type(" `!corona` -> posts latest screenshots for canada and world", { delay: 10 });
                        await doShiftEnter(page);
                        await page.keyboard.type(" `!corona pull {country | world }` -> takes fresh screenshot", { delay: 10 });
                        await doShiftEnter(page);
                        await page.keyboard.type(" `!corona status {country | world }` -> posts latest screenshot ", { delay: 10 });
                        await doShiftEnter(page);
                        await page.keyboard.type(" `!corona help` -> helps", { delay: 10 });
                        await doEnter(page);

                        lock = false;
                    }
                }
            } else if (firstPass) {
                firstPass = false;
            }
        }
    }, 2000);

})();

