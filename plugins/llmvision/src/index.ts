/**
 * LLM Vision plugin — pure TS-native implementation.
 * Calls the HA REST API for timeline events, image analysis, and event creation.
 */

import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

const VALID_LABELS = ["Alarm","Bike","Bird","Bus","Camera","Car","Cat","Dog","Door","Key","Light","Lock","Motorcycle","Package","Person","Plant","Sensor","Tree","Truck","Van"] as const;
const KEYFRAME_DIR = "/tmp/openclaw/llmvision_keyframes";

function httpRequest(method: "GET"|"POST", url: string, headers: Record<string,string>, body?: string, ms=20_000): Promise<{status:number;body:string}> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, {method, headers, timeout: ms}, res => {
      let data = ""; res.on("data", (c:Buffer) => data += c); res.on("end", () => resolve({status: res.statusCode??0, body: data}));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(body); req.end();
  });
}

async function haGet(server: string, token: string, path: string, params?: Record<string,string|number>) {
  let url = `${server}${path}`;
  if (params) url += "?" + Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(String(v))}`).join("&");
  const res = await httpRequest("GET", url, {Authorization:`Bearer ${token}`,"Content-Type":"application/json"});
  if (res.status < 200 || res.status >= 300) return {error:`HTTP ${res.status}: ${res.body.slice(0,500)}`};
  return {output: JSON.parse(res.body)};
}

async function haPost(server: string, token: string, path: string, body: unknown) {
  const res = await httpRequest("POST", `${server}${path}`, {Authorization:`Bearer ${token}`,"Content-Type":"application/json"}, JSON.stringify(body), 30_000);
  if (res.status < 200 || res.status >= 300) return {error:`HTTP ${res.status}: ${res.body.slice(0,500)}`};
  return {output: JSON.parse(res.body)};
}

function fmt(data: unknown) { return {content:[{type:"text" as const, text:JSON.stringify(data)}], details:{}}; }

const configSchema = { type:"object" as const, additionalProperties:false, properties:{
  server:{type:"string" as const, description:"Home Assistant server URL"},
  token:{type:"string" as const, description:"Home Assistant long-lived access token"},
}};

export function createEntry() {
  return {
    id: "llmvision", name: "Home Assistant – LLM Vision",
    description: "Home Assistant LLM Vision integration: analyze camera images with AI, query the vision timeline, and create timeline events.",
    configSchema,
    register(api: PluginApi) {
      const cfg = () => ({
        server: ((api.pluginConfig?.server as string)??"").replace(/\/+$/,"") || (process.env.HASS_SERVER??"http://192.168.1.76:8123"),
        token: (api.pluginConfig?.token as string)??process.env.HASS_TOKEN??"",
      });

      api.registerTool({ name:"llmvision_timeline_get", label:"LLM Vision Timeline",
        description:"Get events from the LLM Vision timeline. Returns AI-generated observation events with timestamps, summaries, and descriptions.",
        parameters: Type.Object({
          days: Type.Optional(Type.Number({description:"Number of days to look back (default: 7)."})),
          limit: Type.Optional(Type.Integer({description:"Maximum number of events to return (default: 50, max: 200)."})),
          start_time: Type.Optional(Type.String({description:"Start of query window as ISO 8601."})),
          end_time: Type.Optional(Type.String({description:"End of query window as ISO 8601. Defaults to now."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {server,token} = cfg();
            const days = Number(p.days??7); const limit = Math.min(Number(p.limit??50),200);
            const res = await haGet(server, token, "/api/llmvision/timeline/events", {limit});
            if ("error" in res) return fmt(res);
            const raw = (res.output as Record<string,unknown>).events as Array<Record<string,unknown>>??[];
            const now = Date.now(); const startDt = p.start_time ? new Date(p.start_time as string).getTime() : now - days*86400000;
            const endDt = p.end_time ? new Date(p.end_time as string).getTime() : now;
            const events = raw.filter(e => {
              try { const t = new Date((e.start??e.when??"") as string).getTime(); return t >= startDt && t <= endDt; } catch { return true; }
            }).map(e => ({title:e.title??"",description:e.description??"",uid:e.uid??"",label:e.label??e.category??"",camera:e.camera_name??"",key_frame:e.key_frame??"",start:e.start??"",end:e.end??""}))
            .sort((a,b)=>b.start.localeCompare(a.start)).slice(0,limit);
            return fmt({count:events.length, events});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"llmvision_get_image", label:"LLM Vision Get Image",
        description:"Download a keyframe image from HA LLM Vision media storage. Pass a key_frame path from a timeline event. Returns the local file path.",
        parameters: Type.Object({ key_frame: Type.String({description:"The key_frame path (e.g. /media/llmvision/snapshots/abc123-camera0.jpg)."}) }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {server,token} = cfg();
            const kf = String(p.key_frame??"").trim();
            if (!kf) return fmt({error:"key_frame is required"});
            const haPath = kf.startsWith("/media/") ? "/media/local" + kf.slice(6) : kf;
            const res = await httpRequest("GET", `${server}${haPath}`, {Authorization:`Bearer ${token}`}, undefined, 15_000);
            if (res.status < 200 || res.status >= 300) return fmt({error:`HTTP ${res.status}`});
            const buf = Buffer.from(res.body, "binary");
            if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return fmt({error:"Response is not a valid JPEG"});
            fs.mkdirSync(KEYFRAME_DIR, {recursive:true});
            const filename = kf.split("/").pop()!;
            const localPath = path.join(KEYFRAME_DIR, filename);
            fs.writeFileSync(localPath, buf);
            return fmt({file:localPath, size_kb:Math.round(buf.length/1024)});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"llmvision_analyze_image", label:"LLM Vision Analyze",
        description:"Trigger an AI image analysis on a Home Assistant camera entity using LLM Vision.",
        parameters: Type.Object({
          camera_entity: Type.String({description:"Camera entity ID (e.g. camera.front_door)."}),
          message: Type.String({description:"Prompt / question to send to the AI about the image."}),
          provider: Type.String({description:"LLM Vision provider (e.g. 'anthropic', 'openai', 'ollama')."}),
          model: Type.Optional(Type.String({description:"Specific model override."})),
          store_in_timeline: Type.Optional(Type.Boolean({description:"Whether to save as a timeline event (default: false)."})),
          expose_images: Type.Optional(Type.Boolean({description:"Whether to expose the captured image in the timeline event."})),
          generate_title: Type.Optional(Type.Boolean({description:"Whether to auto-generate a title for the timeline event."})),
          response_format: Type.Optional(Type.Union([Type.Literal("text"),Type.Literal("json")],{description:"Response format: 'text' (default) or 'json'."})),
          max_tokens: Type.Optional(Type.Integer({description:"Maximum tokens for the AI response."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {server,token} = cfg();
            if (!p.camera_entity) return fmt({error:"camera_entity is required"});
            if (!p.message) return fmt({error:"message is required"});
            if (!p.provider) return fmt({error:"provider is required"});
            const body: Record<string,unknown> = {entity_id:p.camera_entity, message:p.message, provider:p.provider};
            if (p.model) body.model = p.model;
            if (p.store_in_timeline !== undefined) body.store_in_timeline = p.store_in_timeline;
            if (p.expose_images !== undefined) body.expose_images = p.expose_images;
            if (p.generate_title !== undefined) body.generate_title = p.generate_title;
            if (p.response_format) body.response_format = p.response_format;
            if (p.max_tokens) body.max_tokens = p.max_tokens;
            const res = await haPost(server, token, "/api/services/llmvision/image_analyzer", body);
            if ("error" in res) return fmt(res);
            return fmt({result:res.output});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"llmvision_create_event", label:"LLM Vision Create Event",
        description:"Create a new event in the LLM Vision timeline.",
        parameters: Type.Object({
          title: Type.String({description:"Title of the timeline event."}),
          description: Type.String({description:"Detailed description or AI summary for the event."}),
          label: Type.Optional(Type.Union(VALID_LABELS.map(l=>Type.Literal(l)) as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]], {description:"Optional category label (e.g. 'Person', 'Car')."})),
          image_path: Type.Optional(Type.String({description:"Optional path to an image file to attach."})),
          camera_entity: Type.Optional(Type.String({description:"Optional camera entity ID to capture an image from."})),
          start_time: Type.Optional(Type.String({description:"Event start time as ISO 8601 (defaults to now)."})),
          end_time: Type.Optional(Type.String({description:"Event end time as ISO 8601 (defaults to start_time)."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {server,token} = cfg();
            if (!p.title) return fmt({error:"title is required"});
            if (!p.description) return fmt({error:"description is required"});
            const label = p.label as string|undefined;
            if (label && !VALID_LABELS.includes(label as typeof VALID_LABELS[number])) return fmt({error:`Invalid label '${label}'`});
            const body: Record<string,unknown> = {title:p.title, description:p.description};
            if (label) body.label = label;
            if (p.image_path) body.image_path = p.image_path;
            if (p.camera_entity) body.entity_id = p.camera_entity;
            if (p.start_time) body.start_time = p.start_time;
            if (p.end_time) body.end_time = p.end_time;
            const res = await haPost(server, token, "/api/services/llmvision/create_event", body);
            if ("error" in res) return fmt(res);
            return fmt({result:res.output});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });
    },
  };
}
