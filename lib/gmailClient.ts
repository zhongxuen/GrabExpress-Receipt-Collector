import { google, gmail_v1 } from "googleapis";

export interface FoundMessage {
  messageId: string;
}

function getGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

async function listMessagesPage(
  gmail: gmail_v1.Gmail,
  query: string,
  pageToken: string | undefined
): Promise<gmail_v1.Schema$ListMessagesResponse> {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    pageToken,
    maxResults: 100,
  });
  return res.data;
}

/**
 * Searches Gmail for messages matching `query`, following pagination until all
 * results are collected. Returns only message IDs — bodies are fetched separately
 * so callers can report progress incrementally.
 */
export async function searchMessages(
  accessToken: string,
  query: string
): Promise<FoundMessage[]> {
  const gmail = getGmailClient(accessToken);
  const messages: FoundMessage[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const page = await listMessagesPage(gmail, query, pageToken);

    for (const m of page.messages ?? []) {
      if (m.id) messages.push({ messageId: m.id });
    }
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);

  return messages;
}

function findHtmlPart(part: gmail_v1.Schema$MessagePart): string | null {
  if (part.mimeType === "text/html" && part.body?.data) {
    return part.body.data;
  }
  for (const child of part.parts ?? []) {
    const found = findHtmlPart(child);
    if (found) return found;
  }
  return null;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

/**
 * Fetches a single message's HTML body. Returns null if the message has no
 * HTML part (caller should treat this as a skip, not a fatal error).
 */
export async function fetchMessageHtml(
  accessToken: string,
  messageId: string
): Promise<string | null> {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = res.data.payload;
  if (!payload) return null;

  const htmlData = findHtmlPart(payload);
  if (!htmlData) return null;

  return decodeBase64Url(htmlData);
}
