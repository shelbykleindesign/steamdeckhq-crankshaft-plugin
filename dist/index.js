// node_modules/svg-tag-names/index.js
var svgTagNames = [
  "a",
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animate",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "animation",
  "audio",
  "canvas",
  "circle",
  "clipPath",
  "color-profile",
  "cursor",
  "defs",
  "desc",
  "discard",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "font",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignObject",
  "g",
  "glyph",
  "glyphRef",
  "handler",
  "hkern",
  "iframe",
  "image",
  "line",
  "linearGradient",
  "listener",
  "marker",
  "mask",
  "metadata",
  "missing-glyph",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "prefetch",
  "radialGradient",
  "rect",
  "script",
  "set",
  "solidColor",
  "stop",
  "style",
  "svg",
  "switch",
  "symbol",
  "tbreak",
  "text",
  "textArea",
  "textPath",
  "title",
  "tref",
  "tspan",
  "unknown",
  "use",
  "video",
  "view",
  "vkern"
];

// node_modules/dom-chef/index.js
var svgTags = new Set(svgTagNames);
svgTags.delete("a");
svgTags.delete("audio");
svgTags.delete("canvas");
svgTags.delete("iframe");
svgTags.delete("script");
svgTags.delete("video");
var IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var isFragment = (type) => type === DocumentFragment;
var setCSSProps = (element, style) => {
  for (const [name, value] of Object.entries(style)) {
    if (name.startsWith("-")) {
      element.style.setProperty(name, value);
    } else if (typeof value === "number" && !IS_NON_DIMENSIONAL.test(name)) {
      element.style[name] = `${value}px`;
    } else {
      element.style[name] = value;
    }
  }
};
var create = (type) => {
  if (typeof type === "string") {
    if (svgTags.has(type)) {
      return document.createElementNS("http://www.w3.org/2000/svg", type);
    }
    return document.createElement(type);
  }
  if (isFragment(type)) {
    return document.createDocumentFragment();
  }
  return type(type.defaultProps);
};
var setAttribute = (element, name, value) => {
  if (value === void 0 || value === null) {
    return;
  }
  if (/^xlink[AHRST]/.test(name)) {
    element.setAttributeNS("http://www.w3.org/1999/xlink", name.replace("xlink", "xlink:").toLowerCase(), value);
  } else {
    element.setAttribute(name, value);
  }
};
var addChildren = (parent, children) => {
  for (const child of children) {
    if (child instanceof Node) {
      parent.appendChild(child);
    } else if (Array.isArray(child)) {
      addChildren(parent, child);
    } else if (typeof child !== "boolean" && typeof child !== "undefined" && child !== null) {
      parent.appendChild(document.createTextNode(child));
    }
  }
};
var booleanishAttributes = /* @__PURE__ */ new Set([
  "contentEditable",
  "draggable",
  "spellCheck",
  "value",
  "autoReverse",
  "externalResourcesRequired",
  "focusable",
  "preserveAlpha"
]);
var h = (type, attributes, ...children) => {
  var _a;
  const element = create(type);
  addChildren(element, children);
  if (element instanceof DocumentFragment || !attributes) {
    return element;
  }
  for (let [name, value] of Object.entries(attributes)) {
    if (name === "htmlFor") {
      name = "for";
    }
    if (name === "class" || name === "className") {
      const existingClassname = (_a = element.getAttribute("class")) !== null && _a !== void 0 ? _a : "";
      setAttribute(element, "class", (existingClassname + " " + String(value)).trim());
    } else if (name === "style") {
      setCSSProps(element, value);
    } else if (name.startsWith("on")) {
      const eventName = name.slice(2).toLowerCase().replace(/^-/, "");
      element.addEventListener(eventName, value);
    } else if (name === "dangerouslySetInnerHTML" && "__html" in value) {
      element.innerHTML = value.__html;
    } else if (name !== "key" && (booleanishAttributes.has(name) || value !== false)) {
      setAttribute(element, name, value === true ? "" : value);
    }
  }
  return element;
};

// src/index.tsx
var deleteAll = (selector) => document.querySelectorAll(selector).forEach((node) => node.remove());
var NetworkGetError = class extends Error {
  constructor(status) {
    super(`Get returned error status code: ${status}`);
    this.status = status;
  }
};
var SHARED_SELECTORS = {
  appDetails: "[class*=appdetails_Container]",
  appDetailsHeader: '[class^="sharedappdetailsheader_TopCapsule"]',
  appDetailsName: "span[class^=appdetailsplaysection_PlayBarGameName]"
};
var starZero = "https://steamdeckhq.com/wp-content/uploads/2022/07/rating-0-star.svg";
var starOne = "https://steamdeckhq.com/wp-content/uploads/2022/06/rating-1-star.svg";
var starTwo = "https://steamdeckhq.com/wp-content/uploads/2022/06/rating-2-star.svg";
var starThree = "https://steamdeckhq.com/wp-content/uploads/2022/06/rating-3-star.svg";
var starFour = "https://steamdeckhq.com/wp-content/uploads/2022/06/rating-4-star.svg";
var starFive = "https://steamdeckhq.com/wp-content/uploads/2022/06/rating-5-star.svg";
var getTierUrl = (appId) => `https://steamdeckhq.com/wp-json/wp/v2/game-reviews/?meta_key=steam_app_id&meta_value=${appId}&_fields=title,acf.sdhq_rating,link.json`;
var load = (smm) => {
  const protonDbCache = {};
  smm.addEventListener("switchToAppDetails", async (event) => {
    deleteAll("[data-smm-sdhq]");
    const { appId, appName } = event.detail;
    let data = protonDbCache[appId];
    if (!data) {
      try {
        data = await smm.Network.get(getTierUrl(appId));
        protonDbCache[appId] = data;
      } catch (err) {
        if (err instanceof NetworkGetError) {
          smm.Toast.addToast(`Error fetching SDHQ rating for ${appName}`);
          console.info(`Error fetching SDHQ rating for app ${appId}:`, err.status);
          return;
        }
      }
    }
    const { tier } = data;
    console.log(data);
    console.log(data[0].acf.sdhq_rating);
    let starImage;
    if (data[0].acf.sdhq_rating == "0") {
      starImage = starZero;
    }
    if (data[0].acf.sdhq_rating == "1") {
      starImage = starOne;
    }
    if (data[0].acf.sdhq_rating == "2") {
      starImage = starTwo;
    }
    if (data[0].acf.sdhq_rating == "3") {
      starImage = starThree;
    }
    if (data[0].acf.sdhq_rating == "4") {
      starImage = starFour;
    }
    if (data[0].acf.sdhq_rating == "5") {
      starImage = starFive;
    }
    const indicator = /* @__PURE__ */ h("a", {
      href: data[0].link,
      style: {
        position: "absolute",
        bottom: 50,
        right: 24,
        display: "flex",
        alignItems: "center",
        padding: "0px 20px",
        backgroundColor: "rgba(0,0,0,80%)",
        color: "rgba(255,255,255,100%)",
        fontSize: 12,
        textDecoration: "none",
        borderRadius: 4
      },
      "data-smm-sdhq": true
    }, /* @__PURE__ */ h("p", null, "SDHQ Rating:\xA0"), /* @__PURE__ */ h("img", {
      style: {
        width: "70px"
      },
      src: starImage
    }));
    document.querySelector(SHARED_SELECTORS.appDetailsHeader).appendChild(indicator);
  });
};
var unload = () => {
  document.querySelectorAll("[data-smm-sdhq]").forEach((node) => node.remove());
};
export {
  load,
  unload
};
