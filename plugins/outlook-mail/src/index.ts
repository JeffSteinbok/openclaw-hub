/**
 * Outlook Mail plugin — pure TS-native implementation.
 * Search and read personal Outlook inbox via Microsoft Graph API.
 */

import https from "node:https";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function httpPost(url: string, body: string, headers: Record<string,string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {method:"POST",headers,timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve(data));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));}); req.write(body); req.end();
  });
}

function httpGet(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve(data));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));}); req.end();
  });
}

async function getToken(clientId: string, clientSecret: string, refreshToken: string, scope = "Mail.Read"): Promise<string> {
  const body = new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token",scope}).toString();
  const res = await httpPost(TOKEN_URL, body, {"Content-Type":"application/x-www-form-urlencoded"});
  const data = JSON.parse(res);
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0,200)}`);
  return data.access_token;
}

async function graphGet(token: string, path: string): Promise<unknown> {
  const res = await httpGet(`${GRAPH_BASE}${path}`, token);
  return JSON.parse(res);
}

function esc(s: string): string { return s.replace(/'/g,"''"); }

function formatMessage(m: Record<string,unknown>, includeBody = false): Record<string,unknown> {
  const from = (m.from as Record<string,Record<string,string>>)?.emailAddress??{};
  const result: Record<string,unknown> = {
    id: m.id, subject: m.subject??"(no subject)",
    from: `${from.name??""}${from.address?` <${from.address}>`:""}`.trim(),
    received: String(m.receivedDateTime??"").slice(0,10),
    is_read: m.isRead,
    has_attachments: m.hasAttachments,
  };
  if (includeBody) result.body_preview = (m.bodyPreview as string??"").slice(0,500);
  return result;
}

function fmt(data: unknown) { return {content:[{type:"text" as const,text:JSON.stringify(data)}],details:{}}; }

const configSchema = {type:"object" as const, additionalProperties:false, properties:{}};

export function createEntry() {
  return {
    id:"outlook-mail", name:"Outlook Mail",
    description:"Search and read messages from Outlook inboxes",
    configSchema,
    register(api: PluginApi) {
      const creds = () => ({
        clientId: process.env.OUTLOOK_CLIENT_ID??"",
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET??"",
        refreshToken: process.env.OUTLOOK_REFRESH_TOKEN??"",
      });

      api.registerTool({ name:"outlook_inbox", label:"Outlook Inbox",
        description:"List recent messages from the Outlook inbox, or any other mail folder.",
        parameters: Type.Object({
          limit: Type.Optional(Type.Integer({description:"Maximum number of messages to return (default 10)."})),
          unread: Type.Optional(Type.Boolean({description:"Only show unread messages."})),
          folder: Type.Optional(Type.String({description:"Mail folder to read (default: inbox). Well-known folder names: inbox, junkemail, deleteditems, sentitems, drafts, outbox, archive."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret,refreshToken} = creds();
            if (!clientId) return fmt({error:"OUTLOOK_CLIENT_ID not set"});
            const token = await getToken(clientId,clientSecret,refreshToken);
            const limit = Number(p.limit??10); const folder = String(p.folder??"inbox");
            let path = `/me/mailFolders/${encodeURIComponent(folder)}/messages?$top=${limit}&$select=subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview&$orderby=receivedDateTime%20desc`;
            if (p.unread) path += "&$filter=isRead%20eq%20false";
            const data = await graphGet(token, path) as {value:Array<Record<string,unknown>>};
            return fmt({messages:(data.value??[]).map(m=>formatMessage(m,true)), count:data.value?.length??0});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"outlook_search", label:"Outlook Search",
        description:"Search Outlook messages by query text, sender, subject, or date range.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({description:"Full-text search across subject and body."})),
          from: Type.Optional(Type.String({description:"Filter by sender email address."})),
          subject: Type.Optional(Type.String({description:"Filter by subject (substring match)."})),
          since: Type.Optional(Type.String({description:"Only messages received on or after this date (YYYY-MM-DD)."})),
          before: Type.Optional(Type.String({description:"Only messages received on or before this date (YYYY-MM-DD)."})),
          limit: Type.Optional(Type.Integer({description:"Maximum number of results (default 10)."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret,refreshToken} = creds();
            if (!clientId) return fmt({error:"OUTLOOK_CLIENT_ID not set"});
            const token = await getToken(clientId,clientSecret,refreshToken);
            const limit = Number(p.limit??10);
            const filters: string[] = [];
            if (p.from) filters.push(`from/emailAddress/address eq '${esc(String(p.from))}'`);
            if (p.subject) filters.push(`contains(subject,'${esc(String(p.subject))}')`);
            if (p.since) filters.push(`receivedDateTime ge ${p.since}T00:00:00Z`);
            if (p.before) filters.push(`receivedDateTime le ${p.before}T00:00:00Z`);
            const base = `/me/messages?$top=${limit}&$select=subject,from,receivedDateTime,isRead,bodyPreview&$orderby=receivedDateTime%20desc`;
            const path = filters.length ? `${base}&$filter=${encodeURIComponent(filters.join(" and "))}` : base;
            const data = await graphGet(token, path) as {value:Array<Record<string,unknown>>};
            return fmt({messages:(data.value??[]).map(m=>formatMessage(m,true)), count:data.value?.length??0});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"outlook_read", label:"Outlook Read Message",
        description:"Read a specific Outlook message by its ID, including full body content.",
        parameters: Type.Object({
          message_id: Type.String({description:"The Microsoft Graph message ID to retrieve."}),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret,refreshToken} = creds();
            if (!clientId) return fmt({error:"OUTLOOK_CLIENT_ID not set"});
            const token = await getToken(clientId,clientSecret,refreshToken);
            const msgId = String(p.message_id??"").trim();
            if (!msgId) return fmt({error:"message_id is required"});
            const data = await graphGet(token, `/me/messages/${encodeURIComponent(msgId)}`) as Record<string,unknown>;
            const body = (data.body as Record<string,string>|undefined);
            return fmt({...formatMessage(data), body: body?.content??"", content_type: body?.contentType??""});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"outlook_save_attachments", label:"Outlook Save Attachments",
        description:"Download attachments from an Outlook message to a local directory.",
        parameters: Type.Object({
          message_id: Type.String({description:"The Microsoft Graph message ID."}),
          output_dir: Type.String({description:"Local directory path to save attachments to (created if needed)."}),
          content_types: Type.Optional(Type.Array(Type.String(),{description:"Content type filters (e.g. ['image/*']). Defaults to ['image/*']."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const { default: fs } = await import("node:fs");
            const { default: path } = await import("node:path");
            const {clientId,clientSecret,refreshToken} = creds();
            if (!clientId) return fmt({error:"OUTLOOK_CLIENT_ID not set"});
            const token = await getToken(clientId,clientSecret,refreshToken);
            const msgId = String(p.message_id??"").trim();
            const outputDir = String(p.output_dir??"").trim();
            if (!msgId) return fmt({error:"message_id is required"});
            if (!outputDir) return fmt({error:"output_dir is required"});
            const filters = (p.content_types as string[]|undefined)??["image/*"];
            fs.mkdirSync(outputDir,{recursive:true});
            const attData = await graphGet(token, `/me/messages/${encodeURIComponent(msgId)}/attachments`) as {value:Array<Record<string,unknown>>};
            const saved: string[] = [];
            for (const att of attData.value??[]) {
              const ct = String(att.contentType??"");
              const matches = filters.some(f => { if (f.endsWith("/*")) return ct.startsWith(f.slice(0,-1)); return ct===f; });
              if (!matches) continue;
              const name = String(att.name??"attachment");
              const safe = path.basename(name).replace(/[/\\]/g,"_")||"attachment";
              const dest = path.join(outputDir, safe);
              const content = String(att.contentBytes??"");
              fs.writeFileSync(dest, Buffer.from(content,"base64"));
              saved.push(dest);
            }
            return fmt({saved, count:saved.length});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });
    },
  };
}
