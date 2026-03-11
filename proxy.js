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

    document.querySelectorAll("a[href]").forEach((el) => rewrite(el, "href"));
    document.querySelectorAll("img[src]").forEach((el) => rewrite(el, "src"));
    document.querySelectorAll("script[src]").forEach((el) => rewrite(el, "src"));
    document.querySelectorAll("link[href]").forEach((el) => rewrite(el, "href"));
    document.querySelectorAll("form[action]").forEach((el) => rewrite(el, "action"));

    // Make relative URLs inside scripts that call history/location a bit saner
    // by providing a base URL that matches the original target.
    if (!document.querySelector("base")) {
      const base = document.createElement("base");
      base.setAttribute("href", new URL(target).origin + "/");
      const head = document.querySelector("head");
      if (head) {
        head.prepend(base);
      } else {
        document.documentElement.prepend(base);
      }
    }

    // Inject a helper script to keep client-side navigations (pushState, replaceState,
    // location.assign/replace/href) flowing back through /api/proxy so buttons and
    // SPA-style links inside the iframe keep working.
    const helperScript = document.createElement("script");
    helperScript.textContent = `
      (function () {
        try {
          var ORIGIN = ${JSON.stringify(target)};
          function toAbs(u) {
            try { return new URL(u, ORIGIN).href; } catch (e) { return u; }
          }
          function toProxy(u) {
            return "/api/proxy?url=" + encodeURIComponent(toAbs(u));
          }

          var origAssign = window.location.assign.bind(window.location);
          window.location.assign = function (u) {
            return origAssign(toProxy(u));
          };

          var origReplace = window.location.replace.bind(window.location);
          window.location.replace = function (u) {
            return origReplace(toProxy(u));
          };

          var hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
          if (hrefDesc && hrefDesc.configurable) {
            Object.defineProperty(window.location, "href", {
              configurable: true,
              enumerable: hrefDesc.enumerable,
              get: function () { return hrefDesc.get.call(window.location); },
              set: function (v) { origAssign(toProxy(v)); }
            });
          }

          var origPush = history.pushState.bind(history);
          history.pushState = function (state, title, url) {
            if (url != null) url = toProxy(url);
            return origPush(state, title, url);
          };

          var origReplaceState = history.replaceState.bind(history);
          history.replaceState = function (state, title, url) {
            if (url != null) url = toProxy(url);
            return origReplaceState(state, title, url);
          };
        } catch (e) {
          console.warn("[EVR proxy helper] failed to patch history/location", e);
        }
      })();
    `;

    const body = document.querySelector("body");
    if (body) {
      body.appendChild(helperScript);
    } else {
      document.documentElement.appendChild(helperScript);
    }

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
