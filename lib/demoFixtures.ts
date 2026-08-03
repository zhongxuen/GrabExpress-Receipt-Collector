/**
 * Bundled sample messages for Demo Mode (see md files/demo-mode-plan.md). Each
 * entry is shaped like what `fetchMessageContent` (lib/gmailClient.ts) would
 * return for a real Gmail message, so `/api/demo-export` can feed them
 * straight into the same `parseGrabExpressReceipt` / `buildReceiptWorkbook`
 * pipeline the real `/api/export` route uses.
 *
 * The HTML below is modeled on the real GrabExpress receipt structure
 * documented in md files/grabexpress_receipts_raw.md (same label/value
 * layout, same "---------- Forwarded message ---------" wrapper for
 * forwarded mail) but with invented names, emails, booking codes, and
 * amounts — none of this is real user data.
 */

export interface DemoFixtureMessage {
  messageId: string;
  /** Used only for local date-range filtering in the demo route — stands in
   * for the internal date Gmail would otherwise filter `after:`/`before:` on. */
  date: string; // YYYY-MM-DD
  html: string;
  fromHeader: string | null;
}

interface ReceiptBodyOptions {
  totalDisplay: string; // e.g. "RM 12"
  dateDisplay: string; // e.g. "15 Jul 26" — Grab's real on-receipt format
  vehicleType: string;
  driver: string;
  issuedTo: string;
  bookingCode: string | null; // null omits the block entirely (malformed fixture)
  pickup: string;
  dropoff: string;
}

function receiptBodyHtml(opts: ReceiptBodyOptions): string {
  const bookingCodeBlock = opts.bookingCode
    ? `
    <table border="0" cellspacing="0" cellpadding="0" width="100%">
        <tr>
            <td align="left">
                <span style="font-size:10px;color:#9e9e9e;line-height:16px">Booking code</span>
                <br> <span style="font-size:12px;line-height:16px;font-weight:bold">${opts.bookingCode}</span>
            </td>
        </tr>
    </table>`
    : "";

  return `
<div style="font-family:'Helvetica',Arial,sans-serif">
<table width="100%" align="center" border="0" cellspacing="0" cellpadding="0">
    <tr>
        <td align="center" valign="top">
            <table width="600" align="center" border="0" cellspacing="0" cellpadding="0" style="border:1px solid #ededed">
                <tr>
                    <td bgcolor="#ffffff">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0">
                            <tr>
                                <td align="left" style="font-family:Helvetica,'Arial',sans-serif;color:#00af41;font-size:20px;line-height:24px;font-weight:bold;text-align:left"> Your item has been delivered!  </td>
                            </tr>
                            <tr>
                                <td>
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                        <tr>
                                            <td width="44%" align="left" valign="top" style="font-size:12px;line-height:21px;font-weight:bold">TOTAL  <br> <span style="font-size:28px;line-height:32px;font-weight:bold;color:#00af41">${opts.totalDisplay} </span></td>
                                            <td width="56%" align="left" valign="top" style="font-size:12px;line-height:21px;font-weight:bold"> Date
                                                <br> <span style="font-size:18px;font-weight:bold;color:#00af41">${opts.dateDisplay}</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <table width="100%" align="center" border="0" cellspacing="0" cellpadding="0" bgcolor="#f4f4f4">
                <tr>
                    <td align="center" valign="top">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td valign="top" width="200">
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                        <tr>
                                            <td align="left" valign="top" style="font-size:14px;font-weight:bold;color:#00af41">Booking Details</td>
                                        </tr>
                                        <tr>
                                            <td valign="top">
                                                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                                    <tr>
                                                        <td align="left">
                                                            <span style="font-size:10px;color:#9e9e9e;line-height:16px">Vehicle type</span>
                                                            <br> <span style="font-size:12px;line-height:16px;font-weight:bold">${opts.vehicleType}</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                                    <tr>
                                                        <td align="left">
                                                            <span style="font-size:10px;color:#9e9e9e;line-height:14px">Issued by driver </span>
                                                            <br> <span style="font-size:12px;line-height:16px;font-weight:bold">${opts.driver}</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                                    <tr>
                                                        <td align="left">
                                                            <span style="font-size:10px;color:#9e9e9e;line-height:16px">Issued to</span>
                                                            <br> <span style="font-size:12px;line-height:16px;font-weight:bold">${opts.issuedTo}</span>
                                                        </td>
                                                    </tr>
                                                </table>${bookingCodeBlock}
                                                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                                    <tr>
                                                        <td align="left">
                                                            <span style="font-size:10px;color:#9e9e9e;line-height:16px">Item pickup location</span>
                                                            <br> <span style="font-size:12px;line-height:15px;font-weight:bold">${opts.pickup}</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                                    <tr>
                                                        <td align="left">
                                                            <span style="font-size:10px;color:#9e9e9e;line-height:16px">Item drop-off location</span>
                                                            <br> <span style="font-size:12px;line-height:16px;font-weight:bold">${opts.dropoff}</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                                    <tr>
                                                        <td align="left">
                                                            <span style="font-size:10px;color:#9e9e9e;line-height:16px">Profile</span>
                                                            <br> <span style="font-size:12px;line-height:16px;font-weight:bold">PERSONAL</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</div>`;
}

function forwardedWrapper(forwarderEmail: string, forwardDateLine: string, body: string): string {
  return `<div dir="auto"></div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <span dir="auto">&lt;<a href="mailto:no-reply@grab.com">no-reply@grab.com</a>&gt;</span><br>Date: ${forwardDateLine}<br>Subject: Your GrabExpress Receipt<br>To:  &lt;<a href="mailto:${forwarderEmail}">${forwarderEmail}</a>&gt;<br></div><br><br><u></u>
${body}
</div>`;
}

const GRAB_SENDER_HEADER = "GrabExpress <no-reply@grab.com>";

export const demoFixtures: DemoFixtureMessage[] = [
  // Original — direct from no-reply@grab.com
  {
    messageId: "demo-msg-001",
    date: "2026-07-15",
    fromHeader: GRAB_SENDER_HEADER,
    html: receiptBodyHtml({
      totalDisplay: "RM 12",
      dateDisplay: "15 Jul 26",
      vehicleType: "GrabExpress Instant -- Bike",
      driver: "TAN*",
      issuedTo: "Alex Lim",
      bookingCode: "A-7ZQPLKX2NNQ9DM",
      pickup: "12, Jalan Teknologi 3/4, Bandar Sunway, 47500, Petaling, Selangor, Malaysia",
      dropoff: "8, Jalan Cyber 2/3, Cyberjaya, 63000, Sepang, Selangor, Malaysia",
    }),
  },
  // Original — direct from no-reply@grab.com
  {
    messageId: "demo-msg-002",
    date: "2026-06-05",
    fromHeader: GRAB_SENDER_HEADER,
    html: receiptBodyHtml({
      totalDisplay: "RM 25",
      dateDisplay: "5 Jun 26",
      vehicleType: "GrabExpress Saver -- Car",
      driver: "RAJ*",
      issuedTo: "Priya Nair",
      bookingCode: "A-4KPXQMZ7VNTR2W",
      pickup: "8, Jalan Damansara Utama 2, 47400, Petaling Jaya, Selangor, Malaysia",
      dropoff: "45, Jalan Ampang, 50450, Kuala Lumpur, Malaysia",
    }),
  },
  // Forwarded — relayed by whoever booked the delivery, envelope sender != grab.com
  {
    messageId: "demo-msg-003",
    date: "2026-07-20",
    fromHeader: "demo.forwarder1@example.com",
    html: forwardedWrapper(
      "demo.forwarder1@example.com",
      "Mon, 20 Jul 2026, 11:05 am",
      receiptBodyHtml({
        totalDisplay: "RM 8",
        dateDisplay: "20 Jul 26",
        vehicleType: "GrabExpress Instant -- Bike",
        driver: "LEE*",
        issuedTo: "Sarah Chong",
        bookingCode: "A-9WQTZP3XKNM8RD",
        pickup: "3, Jalan SS15/4, 47500, Subang Jaya, Selangor, Malaysia",
        dropoff: "20, Jalan Bukit Bintang, 55100, Kuala Lumpur, Malaysia",
      })
    ),
  },
  // Forwarded — relayed by whoever booked the delivery, envelope sender != grab.com
  {
    messageId: "demo-msg-004",
    date: "2026-05-10",
    fromHeader: "demo.forwarder2@example.com",
    html: forwardedWrapper(
      "demo.forwarder2@example.com",
      "Sun, 10 May 2026, 4:45 pm",
      receiptBodyHtml({
        totalDisplay: "RM 15",
        dateDisplay: "10 May 26",
        vehicleType: "GrabExpress Saver -- Car",
        driver: "WONG*",
        issuedTo: "David Ong",
        bookingCode: "A-2MXNRQT8ZKWP4H",
        pickup: "17, Jalan Kuchai Lama, 58200, Kuala Lumpur, Malaysia",
        dropoff: "9, Jalan Puchong, 47100, Puchong, Selangor, Malaysia",
      })
    ),
  },
  // Deliberately malformed — no Booking Code block, so parsing fails and the
  // message shows up in the demo's skipped-message list instead of exporting.
  {
    messageId: "demo-msg-005",
    date: "2026-07-01",
    fromHeader: GRAB_SENDER_HEADER,
    html: receiptBodyHtml({
      totalDisplay: "RM 10",
      dateDisplay: "1 Jul 26",
      vehicleType: "GrabExpress Instant -- Bike",
      driver: "NG*",
      issuedTo: "Farah Aziz",
      bookingCode: null,
      pickup: "5, Jalan Kelana Jaya, 47301, Petaling Jaya, Selangor, Malaysia",
      dropoff: "30, Jalan Genting Klang, 53300, Kuala Lumpur, Malaysia",
    }),
  },
];
