import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export async function proxyHandler(req, res) {
  let target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  if (!target.startsWith("http")) {
    target = "https://" + target;
  }

  const response = await fetch(target, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
    redirect: "manual",
  });

  // Handle redirects
  const location = response.headers.get("location");
  if (location) {
    const newUrl = new URL(location, target).href;
    return res.redirect(
      `/api/proxy?url=${encodeURIComponent(newUrl)}`
    );
  }

  const contentType = response.headers.get("content-type") || "";

  // ========= HTML =========
  if (contentType.includes("text/html")) {
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const rewrite = (el, attr) => {
      const val = el.getAttribute(attr);
      if (!val || val.startsWith("data:") || val.startsWith("javascript:")) return;

      const absolute = new URL(val, target).href;
      el.setAttribute(
        attr,
        `/api/proxy?url=${encodeURIComponent(absolute)}`
      );
    };

    document.querySelectorAll("a[href]").forEach(el => rewrite(el, "href"));
    document.querySelectorAll("img[src]").forEach(el => rewrite(el, "src"));
    document.querySelectorAll("script[src]").forEach(el => rewrite(el, "src"));
    document.querySelectorAll("link[href]").forEach(el => rewrite(el, "href"));
    document.querySelectorAll("form[action]").forEach(el => rewrite(el, "action"));

    res.setHeader("content-type", "text/html");
    return res.send(dom.serialize());
  }

  // ========= CSS =========
  if (contentType.includes("text/css")) {
    let css = await response.text();

    css = css.replace(/url\((.*?)\)/g, (match, url) => {
      url = url.replace(/['"]/g, "");
      if (url.startsWith("data:")) return match;

      const absolute = new URL(url, target).href;
      return `url(/api/proxy?url=${encodeURIComponent(absolute)})`;
    });

    res.setHeader("content-type", "text/css");
    return res.send(css);
  }

  // ========= Everything else (images, fonts, js) =========
  const buffer = Buffer.from(await response.arrayBuffer());
  res.setHeader("content-type", contentType);
  res.send(buffer);
}
