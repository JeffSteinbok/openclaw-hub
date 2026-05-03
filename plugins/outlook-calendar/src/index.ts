/**
 * Outlook Calendar plugin — pure TS-native implementation.
 * Fetches personal and family calendars via Microsoft Graph API.
 */

import https from "node:https";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const CALENDAR_DEFAULTS: Record<string,string[]> = { personal:["calendar","personal"], family:["family v2","your family","family"] };
const CALENDAR_ENV_VARS: Record<string,string> = { personal:"OUTLOOK_PERSONAL_CALENDAR_NAMES", family:"OUTLOOK_FAMILY_CALENDAR_NAMES" };

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

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token",scope:"Calendars.Read"}).toString();
  const res = await httpPost(TOKEN_URL, body, {"Content-Type":"application/x-www-form-urlencoded"});
  return JSON.parse(res).access_token;
}

async function graphGet(token: string, path: string): Promise<unknown> {
  const res = await httpGet(`${GRAPH_BASE}${path}`, token);
  return JSON.parse(res);
}

function utcToLocal(s: string): string {
  try {
    const dt = new Date(s.slice(0,19)+"Z");
    return dt.toLocaleString("en-US",{year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",minute:"2-digit",hour12:true});
  } catch { return s.slice(0,16); }
}

function formatEvent(e: Record<string,unknown>): Record<string,unknown> {
  const start = (e.start as Record<string,string>); const end = (e.end as Record<string,string>);
  const tz = start?.timeZone??"UTC";
  const fmtTime = (s:string) => tz==="UTC" ? utcToLocal(s) : s.slice(0,16);
  const attendees = ((e.attendees??[]) as Array<Record<string,unknown>>).map(a => {
    const ea = (a.emailAddress??{}) as Record<string,string>;
    return {name:ea.name??"",email:ea.address??"",status:((a.status as Record<string,string>)?.response??"none"),type:String(a.type??"required")};
  });
  const result: Record<string,unknown> = {
    subject:String(e.subject??"No subject"), start:fmtTime(start?.dateTime??""), end:fmtTime(end?.dateTime??""),
    location:((e.location as Record<string,string>)?.displayName||"No location"),
    organizer:((e.organizer as Record<string,Record<string,string>>)?.emailAddress?.name||((e.organizer as Record<string,Record<string,string>>)?.emailAddress?.address??"")),
    my_status:((e.responseStatus as Record<string,string>)?.response??"none"), show_as:String(e.showAs??"busy"),
  };
  if (attendees.length) result.attendees = attendees;
  return result;
}

function calendarSearchNames(key: string): string[] {
  const extras = process.env[CALENDAR_ENV_VARS[key]]??"";
  const extraNames = extras.split(",").map(n=>n.trim().toLowerCase()).filter(Boolean);
  return [...extraNames, ...CALENDAR_DEFAULTS[key]];
}

function fmt(data: unknown) { return {content:[{type:"text" as const,text:JSON.stringify(data)}],details:{}}; }

const configSchema = {type:"object" as const, additionalProperties:false, properties:{}};

export function createEntry() {
  return {
    id:"outlook-calendar", name:"Outlook Calendar",
    description:"Fetch upcoming events from Outlook personal and family calendars",
    configSchema,
    register(api: PluginApi) {
      const creds = () => ({
        clientId: process.env.OUTLOOK_CLIENT_ID??"",
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET??"",
        refreshToken: process.env.OUTLOOK_REFRESH_TOKEN??"",
      });

      api.registerTool({ name:"outlook_calendar_fetch", label:"Outlook Calendar",
        description:"Fetch upcoming events from Outlook personal, family, or combined calendars.",
        parameters: Type.Object({
          calendar: Type.Optional(Type.Union([Type.Literal("personal"),Type.Literal("family"),Type.Literal("all")],{description:"Which calendar to fetch: personal, family, or all (default: all)."})),
          days: Type.Optional(Type.Integer({description:"Number of days ahead to fetch events for (default: 7)."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret,refreshToken} = creds();
            if (!clientId||!clientSecret||!refreshToken) return fmt({error:"OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set"});
            const calendar = String(p.calendar??"all"); const days = Number(p.days??7);
            const token = await getAccessToken(clientId,clientSecret,refreshToken);
            const calData = await graphGet(token,"/me/calendars?$select=id,name&$top=50") as {value:Array<{name:string;id:string}>};
            const calMap: Record<string,string> = {};
            for (const c of calData.value??[]) calMap[c.name.toLowerCase()] = c.id;
            const start = new Date().toISOString().slice(0,10);
            const end = new Date(Date.now()+days*86400000).toISOString().slice(0,10);
            const keys = calendar==="all" ? ["personal","family"] : [calendar];
            const results: Record<string,unknown> = {};
            for (const key of keys) {
              const searchNames = calendarSearchNames(key);
              const calId = searchNames.map(n=>calMap[n]).find(Boolean);
              if (!calId) { results[key] = {label:key,error:`Calendar not found. Available: ${Object.keys(calMap).join(", ")}`,events:[]}; continue; }
              const params = new URLSearchParams({"$select":"subject,start,end,location,organizer,attendees,responseStatus,showAs","$orderby":"start/dateTime","$top":"100","startDateTime":`${start}T00:00:00`,"endDateTime":`${end}T00:00:00`}).toString();
              const evData = await graphGet(token,`/me/calendars/${calId}/calendarView?${params}`) as {value:Array<Record<string,unknown>>};
              const events = (evData.value??[]).map(formatEvent);
              results[key] = {label:key==="personal"?"Personal":"Family",count:events.length,start_date:start,end_date:end,events};
            }
            return fmt(results);
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });
    },
  };
}
