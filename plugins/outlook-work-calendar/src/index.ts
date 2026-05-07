/**
 * Outlook Work Calendar plugin — pure TS-native implementation.
 * Uses EWS JSON API via published calendar endpoint (no auth required).
 */

import https from "node:https";
import http from "node:http";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

function httpPost(url: string, body: string, headers: Record<string,string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, {method:"POST",headers,timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve(data));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));}); req.write(body); req.end();
  });
}

function buildRequestBody(folderId: string, startDate: string, endDate: string): unknown {
  const fmtDt = (d: string) => new Date(d).toISOString().replace(/Z$/,".000").slice(0,23);
  return {
    "__type":"FindItemJsonRequest:#Exchange",
    Header:{"__type":"JsonRequestHeaders:#Exchange",RequestServerVersion:"Exchange2013",
      TimeZoneContext:{"__type":"TimeZoneContext:#Exchange",TimeZoneDefinition:{"__type":"TimeZoneDefinitionType:#Exchange",Id:"Pacific Standard Time"}}},
    Body:{"__type":"FindItemRequest:#Exchange",
      ParentFolderIds:[{"__type":"FolderId:#Exchange",Id:folderId}],
      ItemShape:{"__type":"ItemResponseShape:#Exchange",BaseShape:"IdOnly"},
      Traversal:"Shallow",
      Paging:{"__type":"CalendarPageView:#Exchange",StartDate:fmtDt(startDate),EndDate:fmtDt(endDate)}},
  };
}

function extractEvents(response: unknown): unknown[] {
  try {
    const body = (response as Record<string,unknown>).Body as Record<string,unknown>;
    const items = (body?.ResponseMessages as Record<string,unknown>)?.Items as Array<Record<string,unknown>>;
    return ((items?.[0]?.RootFolder as Record<string,unknown>)?.Items as unknown[]) ?? [];
  } catch { return []; }
}

function formatEvent(e: Record<string,unknown>): Record<string,unknown> {
  const subject = String(e.Subject??"No subject");
  const sensitivity = String(e.Sensitivity??"Normal");
  const isAllDay = Boolean(e.IsAllDayEvent);
  const title = subject + (sensitivity==="Private"?" [PRIVATE]":"") + (isAllDay?" [ALL DAY]":"");
  return {
    subject: title, start: String(e.Start??""), end: String(e.End??""),
    location: (e.Location as Record<string,string>|undefined)?.DisplayName || "No location",
    busy_type: String(e.FreeBusyType??"busy"), is_all_day: isAllDay,
  };
}

function fmt(data: unknown) { return {content:[{type:"text" as const,text:JSON.stringify(data)}],details:{}}; }

const configSchema = {type:"object" as const, additionalProperties:false, properties:{}};

export function createEntry() {
  return {
    id:"outlook-work-calendar", name:"Outlook Work Calendar",
    description:"Fetch upcoming events from the published Outlook work calendar. Uses the EWS JSON API — no authentication required.",
    configSchema,
    register(api: PluginApi) {
      api.registerTool({ name:"outlook_work_calendar_fetch", label:"Outlook Work Calendar",
        description:"Fetch upcoming events from the published Outlook work calendar. Requires OUTLOOK_WORK_CALENDAR_URL and OUTLOOK_WORK_FOLDER_ID environment variables.",
        parameters: Type.Object({
          days: Type.Optional(Type.Integer({description:"Number of days ahead to fetch (default 7)", default:7})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const baseUrl = process.env.OUTLOOK_WORK_CALENDAR_URL??"";
            const folderId = process.env.OUTLOOK_WORK_FOLDER_ID??"";
            if (!baseUrl) return fmt({error:"OUTLOOK_WORK_CALENDAR_URL is not set"});
            if (!folderId) return fmt({error:"OUTLOOK_WORK_FOLDER_ID is not set"});
            const days = Number(p.days??7);
            const startDate = new Date().toISOString().slice(0,10);
            const endDate = new Date(Date.now()+days*86400000).toISOString().slice(0,10);
            const url = `${baseUrl}/service.svc?action=FindItem&app=PublishedCalendar&n=18`;
            const body = JSON.stringify(buildRequestBody(folderId, startDate, endDate));
            const res = await httpPost(url, body, {"Content-Type":"application/json; charset=utf-8","Action":"FindItem"});
            const data = JSON.parse(res);
            const events = extractEvents(data).map(e => formatEvent(e as Record<string,unknown>));
            return fmt({start_date:startDate, end_date:endDate, count:events.length, events});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });
    },
  };
}
