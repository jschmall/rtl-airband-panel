// Takes the docs screenshots from a running panel; see run.sh.
//
//   node shoot.cjs PANEL_URL OUT_DIR
//
// CHROMIUM and PLAYWRIGHT_CORE (env) locate the browser and the
// playwright-core package. The editor, Apply live and Stats shots use the
// instance with the most channels (or EDITOR_INSTANCE).
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE);

const [url, out] = process.argv.slice(2);
const DESKTOP = { width: 1440, height: 1000 };
const TALL = { width: 1440, height: 1200 };
const PHONE = { width: 390, height: 844 };

async function main() {
  const instances = await (await fetch(`${url}/api/instances`)).json();
  const busiest = process.env.EDITOR_INSTANCE ?? [...instances].sort((a, b) => (b.frequencies?.length ?? 0) - (a.frequencies?.length ?? 0))[0].name;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
  const page = async (viewport, colorScheme = "dark") => {
    const p = await browser.newPage({ viewport, colorScheme });
    p.on("dialog", (d) => d.accept());
    return p;
  };
  const shot = async (p, name, opts = {}) => {
    await p.screenshot({ path: path.join(out, name), ...opts });
    console.log(name);
  };

  // Overview, in both themes and on a phone.
  for (const scheme of ["dark", "light"]) {
    const p = await page(DESKTOP, scheme);
    await p.goto(`${url}/`);
    await p.getByText(busiest, { exact: true }).first().waitFor();
    await p.waitForTimeout(1500);
    await shot(p, scheme === "dark" ? "overview.png" : "overview-light.png");
    await p.close();
  }
  {
    const p = await page(PHONE);
    await p.goto(`${url}/`);
    await p.waitForTimeout(1500);
    await shot(p, "overview-phone.png");
    await p.close();
  }

  // Hardware: live readings from the fake control sockets, with seeded history.
  {
    const p = await page(TALL);
    await p.goto(`${url}/hardware`);
    await p.getByText("Live", { exact: true }).first().waitFor();
    await p.waitForTimeout(4000);
    await shot(p, "hardware.png");
    await p.close();
  }

  // Instance editor: open the first device, change its gain so the bar
  // predicts a live apply, and open the preview's details.
  const p = await page(DESKTOP);
  await p.goto(`${url}/instances/${encodeURIComponent(busiest)}?device=0`);
  await p.getByRole("button", { name: /^Instance settings/ }).click();
  await p.getByRole("button", { name: /^Service account/ }).click();
  const gain = p.getByLabel(/^Gain/).first();
  await gain.waitFor();
  const current = Number(await gain.inputValue()) || 30;
  await gain.fill(String(Math.round((current - 1.2) * 10) / 10));
  await p.getByText("Details", { exact: true }).waitFor();
  await p.getByText("Details", { exact: true }).click();
  await p.waitForTimeout(800);
  await p.getByRole("button", { name: /Device —/ }).first().scrollIntoViewIfNeeded();
  await p.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  await shot(p, "instance-editor.png");

  // One channel with its outputs.
  const channel = p.getByRole("button", { name: /^Channel \d/ }).first();
  await channel.click();
  const section = channel.locator("xpath=ancestor::div[contains(@class, 'rounded')][1]");
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await p.waitForTimeout(500);
  await shot(p, "channel-editor.png", { clip: await section.boundingBox() });

  // Apply live: the fake socket reports the gain change as applied.
  await p.getByRole("button", { name: "Apply live" }).click();
  await p.getByText(/Applied live to|Applied \d+ change/).waitFor();
  await p.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  await p.waitForTimeout(500);
  await shot(p, "apply-live.png", { clip: { x: 0, y: 0, width: DESKTOP.width, height: 420 } });
  await p.close();

  // Stats: signal vs squelch over 6 hours on the instance's busiest channel
  // (most squelch opens).
  {
    const latest = await (await fetch(`${url}/api/instances/${encodeURIComponent(busiest)}/stats/latest`)).json();
    const opens = latest.filter((x) => x.metric === "channel_squelch_counter").sort((a, b) => b.value - a.value)[0];
    const s = await page(DESKTOP);
    await s.goto(`${url}/stats`);
    await s.getByLabel("Device").selectOption(busiest);
    if (opens?.labels.freq) {
      const channel = s.getByLabel("Channel");
      const value = await channel.locator("option", { hasText: `${opens.labels.freq} MHz` }).first().getAttribute("value");
      if (value) await channel.selectOption(value);
    }
    await s.getByRole("button", { name: "Last 6 hours" }).click();
    await s.waitForTimeout(3000);
    await shot(s, "stats.png");
    await s.close();
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
