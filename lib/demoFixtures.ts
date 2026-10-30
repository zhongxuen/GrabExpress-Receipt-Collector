/**
 * Bundled sample messages for Demo Mode (see md files/demo-mode-plan.md). Each
 * entry is shaped like what `fetchMessageContent` (lib/gmailClient.ts) would
 * return for a real Gmail message, so `/api/demo-export` can feed them
 * straight into the same `parseGrabReceipt` / `buildReceiptWorkbook`
 * pipeline the real `/api/export` route uses.
 *
 * The HTML below is modeled on the real Grab receipt structures documented in
 * md files/grabexpress_receipts_raw.md and md files/general-grab-receipts-plan.md
 * (same label/value layouts, same "---------- Forwarded message ---------"
 * wrapper for forwarded mail) but with invented names, emails, booking codes,
 * order IDs, restaurants, and amounts — none of this is real user data.
 */

import type { GrabService } from "./types";

export interface DemoFixtureMessage {
  messageId: string;
  /** Used only for local date-range filtering in the demo route — stands in
   * for the internal date Gmail would otherwise filter `after:`/`before:` on. */
  date: string; // YYYY-MM-DD
  /** Used only for the demo route's service filter — stands in for the
   * per-service Gmail search clause. The parser still decides from the body. */
  category: GrabService;
  html: string;
  fromHeader: string | null;
  subject: string | null;
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

function labelBlock(label: string, value: string): string {
  return `
                <table border="0" cellspacing="0" cellpadding="0" width="100%">
                    <tr>
                        <td align="left" class="tdp5"> <span style="font-size:10px;color:#9e9e9e">${label}</span><br/> <span style="font-size:12px;font-weight:bold">${value}</span> </td>
                    </tr>
                </table>`;
}

interface FoodReceiptOptions {
  totalDisplay: string; // e.g. "RM 16.50" (delivery) or "MYR 4.56" (dine-in)
  dateDisplay: string; // e.g. "23 Oct 26 09:57 +0800"
  /** Delivery shows "Pick-up time:" before the date; dine-in shows the bare date. */
  pickupPrefix: boolean;
  /** [label, value] pairs for the Booking Details column, in display order. */
  details: [string, string][];
  lineItems: [string, string][]; // [description, "RM 14.50"]
}

/** Modeled on the GrabFood "Your Grab E-Receipt" template (delivery and
 * dine-in share it, with different Booking Details labels). */
function foodReceiptHtml(opts: FoodReceiptOptions): string {
  const summaryRows = opts.lineItems
    .map(
      ([description, amount]) => `
                    <tr>
                        <td align="left" class="tdp5" width="15"></td>
                        <td align="left" class="tdp5"> <span>${description}</span> </td>
                        <td align="left" class="tdp5"> <span>&nbsp;&nbsp;${amount} </span> </td>
                        <td align="left" class="tdp5" width="15"></td>
                    </tr>`
    )
    .join("");

  return `
<table width="600" align="center" border="0" cellspacing="0" cellpadding="0" class="borderPerTab">
    <tr>
        <td bgcolor="#ffffff">
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                    <td align="left" style="color:#00b14f;font-size:20px;font-weight:bold"> Hope you enjoyed your food!</td>
                </tr>
            </table>
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                    <td width="44%" align="left" valign="top" class="produceTdLast">TOTAL<br /> <span style="font-size:28px;font-weight:bold">${opts.totalDisplay}</span></td>
                    <td width="56%" align="left" valign="top" class="produceTdLast">DATE&nbsp;&nbsp;|&nbsp; TIME<br />${opts.pickupPrefix ? " Pick-up time:" : ""} <span style="font-size:14px;font-weight:bold">${opts.dateDisplay}</span></td>
                </tr>
            </table>
        </td>
    </tr>
    <tr>
        <td bgcolor="#f4f4f4">
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr><td align="left" style="font-size:14px;font-weight:bold">Booking Details</td></tr>
            </table>${opts.details.map(([label, value]) => labelBlock(label, value)).join("")}
        </td>
    </tr>
    <tr>
        <td bgcolor="#ffffff">
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr><td align="left" style="font-size:14px;font-weight:bold">Receipt Summary</td></tr>
            </table>
            <table border="0" cellspacing="0" cellpadding="0" width="100%">${summaryRows}
                <tr>
                    <td align="left" class="tdp5" width="15"></td>
                    <td align="right" class="tdp5"> <span>TOTAL (INCL. TAX)&nbsp;&nbsp;&nbsp;&nbsp;</span> </td>
                    <td align="left" class="tdp5"> <span>&nbsp;&nbsp;${opts.totalDisplay}</span> </td>
                    <td align="left" class="tdp5" width="15"></td>
                </tr>
            </table>
        </td>
    </tr>
</table>`;
}

interface RideReceiptOptions {
  rideType: string; // e.g. "Standard (JustGrab)"
  pickedUpOn: string; // e.g. "14 February 2026" — full month, 4-digit year
  bookingId: string;
  total: string; // e.g. "18.30" — shown as "RM 18.30" up top, bare in the breakdown
  fare: string;
  driver: string;
  passenger: string;
  pickup: string;
  pickupTime: string; // e.g. "11:58AM"
  dropoff: string;
  dropoffTime: string;
  tripSummary: string; // e.g. "11.45 km • 29 mins"
}

/** Modeled on the newer div-based GrabCar "Your Grab E-Receipt" template. */
function rideReceiptHtml(opts: RideReceiptOptions): string {
  return `
<div style="background-color:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td bgcolor="#00b14f">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td align="left" class="sm-p-16" width="1"><div style="color:#fff;white-space:nowrap">${opts.rideType}</div></td>
<td align="right" class="sm-p-16" width="600"><img alt="Grab" src="https://example.com/logo.png" width="48"></td>
</tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td align="left" valign="top" width="312">
<div class="sm-px-16"><div style="color:#fff;font-size:24px">Hope you enjoyed your ride!</div><div><div style="color:#fff">Picked up on ${opts.pickedUpOn}</div><div style="color:#fff;white-space:nowrap">Booking ID: ${opts.bookingId}</div></div></div>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td class="sm-px-16">
<div><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="left" width="100%">Total Paid</td><td align="right" width="1"><div>RM ${opts.total}</div></td></tr></table></div>
<div>Receipt issued by the driver <span>${opts.driver}</span>.</div>
<div>Breakdown</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr><td align="left" width="100%">Fare</td><td align="right">${opts.fare}</td></tr>
<tr><td align="left" width="100%">Total Paid</td><td align="right">${opts.total}</td></tr>
</table>
<div>Passenger</div><div>${opts.passenger}</div>
<div>Profile</div><div>PERSONAL</div>
<div><div>Your Trip</div><div>${opts.tripSummary}</div></div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr><td valign="top" align="center" width="32"><img alt="pick-up" src="https://example.com/icon_pick_up.png" height="24"><div><div>&#8942;</div><div>&#8942;</div></div></td><td valign="top"><div> ${opts.pickup} </div><div>${opts.pickupTime}</div></td></tr>
<tr><td valign="top" align="center" width="32"><img alt="drop-off" src="https://example.com/icon_drop_off.png" height="24"></td><td valign="top"><div> ${opts.dropoff} </div><div>${opts.dropoffTime}</div></td></tr>
</table>
<div>&copy; Grab 2026</div>
</td>
</tr>
</table>
</div>`;
}

interface PaymentReceiptOptions {
  merchant: string;
  orderAmount: string; // e.g. "45.00"
  offer: string; // e.g. "5.00" — shown as "-RM5.00"
  pointsUsed: string; // RM value of points redeemed
  points: number; // points redeemed
  total: string; // what was actually paid: order - offer - points
  rewards: number;
  paymentMethod: string;
  transactionId: string; // 32 hex chars
}

function paymentRow(label: string, value: string, bold = false): string {
  const style = bold ? ' style="margin: 0px; font-weight: bold"' : "";
  return `
                <tr>
                  <td class="txn-label"><p class="paysummary"${style}>${label}</p></td>
                  <td class="txn-val"><p class="paysummary"${style}>${value}</p></td>
                </tr>`;
}

/** Modeled on the GrabPay "You've made a payment to <Merchant> 🎉" template.
 * Note there's no date anywhere in the body — it comes from the message time. */
function paymentReceiptHtml(opts: PaymentReceiptOptions): string {
  return `
<table width="600" align="center" style="border-spacing:0">
  <tr>
    <td class="head-table2-illustration">
      <div class="head-table1-para">You've made a payment to ${opts.merchant} 🎉</div>
    </td>
  </tr>
  <tr><td class="td-outline"><p class="payment-summary-para">Payment summary</p></td></tr>
  <tr>
    <td class="td-outline">
      <table style="display: table;width: 100%;">
        <tbody>${paymentRow("Order amount", `RM${opts.orderAmount}`)}${paymentRow("Offer applied", `-RM${opts.offer}`)}${paymentRow("Points used", `-RM${opts.pointsUsed} <br />(${opts.points} points)`)}${paymentRow("Total", `RM${opts.total}`, true)}
                <td><hr /></td><td><hr /></td>${paymentRow("Rewards", `${opts.rewards} points`)}${paymentRow("Payment to", opts.merchant)}${paymentRow("Payment method", opts.paymentMethod)}${paymentRow("Transaction ID", opts.transactionId)}
        </tbody>
      </table>
    </td>
  </tr>
</table>`;
}

const GRAB_SENDER_HEADER = "GrabExpress <no-reply@grab.com>";
const GRAB_ERECEIPT_SENDER_HEADER = "Grab <no-reply@grab.com>";

export const demoFixtures: DemoFixtureMessage[] = [
  // Original — direct from no-reply@grab.com
  {
    messageId: "demo-msg-001",
    date: "2026-07-15",
    category: "express",
    fromHeader: GRAB_SENDER_HEADER,
    subject: "Your GrabExpress Receipt",
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
    category: "express",
    fromHeader: GRAB_SENDER_HEADER,
    subject: "Your GrabExpress Receipt",
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
    category: "express",
    fromHeader: "demo.forwarder1@example.com",
    subject: "Fwd: Your GrabExpress Receipt",
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
    category: "express",
    fromHeader: "demo.forwarder2@example.com",
    subject: "Fwd: Your GrabExpress Receipt",
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
    category: "express",
    fromHeader: GRAB_SENDER_HEADER,
    subject: "Your GrabExpress Receipt",
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
  // GrabFood delivery
  {
    messageId: "demo-msg-006",
    date: "2026-07-18",
    category: "food",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "Your Grab E-Receipt",
    html: foodReceiptHtml({
      totalDisplay: "RM 23.40",
      dateDisplay: "18 Jul 26 12:41 +0800",
      pickupPrefix: true,
      details: [
        ["Vehicle type:", "GrabFood"],
        ["Issued to", "Alex Lim"],
        ["Booking code", "A-8DMQX4TZRW2KLV"],
        ["Order location:", "Kedai Mee Demo - Bandar Sunway"],
        ["Delivery location:", "12, Jalan Teknologi 3/4, Bandar Sunway"],
      ],
      lineItems: [
        ["Subtotal", "RM 19.90"],
        ["Delivery fee", "RM 3.50"],
      ],
    }),
  },
  // GrabFood delivery fully covered by a voucher — a real RM 0.00 receipt,
  // exported rather than skipped.
  {
    messageId: "demo-msg-007",
    date: "2026-06-22",
    category: "food",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "Your Grab E-Receipt",
    html: foodReceiptHtml({
      totalDisplay: "RM 0.00",
      dateDisplay: "22 Jun 26 18:26 +0800",
      pickupPrefix: true,
      details: [
        ["Vehicle type:", "GrabFood"],
        ["Issued to", "Priya Nair"],
        ["Booking code", "A-3VNPQ8KXWD7TMS"],
        ["Order location:", "Sample Burger Co. - Damansara Utama"],
        ["Delivery location:", "8, Jalan Damansara Utama 2, Petaling Jaya"],
      ],
      lineItems: [
        ["Subtotal", "RM 15.00"],
        ["Promotion", "-RM 15.00"],
      ],
    }),
  },
  // GrabFood dine-in (scan-to-order): MYR prefix, Order ID instead of Booking code
  {
    messageId: "demo-msg-008",
    date: "2026-07-09",
    category: "food",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "Your Grab E-Receipt",
    html: foodReceiptHtml({
      totalDisplay: "MYR 9.80",
      dateDisplay: "09 Jul 26 13:05 +0800",
      pickupPrefix: false,
      details: [
        ["Type of order:", "Dine-in"],
        ["Ordered by", "Sarah Chong"],
        ["Order ID", "009876543210-C8DEMO7XQ2LM"],
        ["Restaurant:", "Demo Kopitiam - Subang Jaya"],
        ["Table number:", "B07"],
      ],
      lineItems: [["Subtotal", "MYR 9.80"]],
    }),
  },
  // GrabCar ride (newer div-based template)
  {
    messageId: "demo-msg-009",
    date: "2026-07-02",
    category: "transport",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "Your Grab E-Receipt",
    html: rideReceiptHtml({
      rideType: "Standard (JustGrab)",
      pickedUpOn: "2 July 2026",
      bookingId: "A-9RXDEMOT4KQ2WV",
      total: "18.30",
      fare: "18.00",
      driver: "DEMO DRIVER A",
      passenger: "David Ong",
      pickup: "Sunway Pyramid Shopping Mall",
      pickupTime: "6:42PM",
      dropoff: "12, Jalan Teknologi 3/4",
      dropoffTime: "7:05PM",
      tripSummary: "9.80 km • 23 mins",
    }),
  },
  // GrabCar ride, different product
  {
    messageId: "demo-msg-010",
    date: "2026-05-28",
    category: "transport",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "Your Grab E-Receipt",
    html: rideReceiptHtml({
      rideType: "Standard | Top-Rated Drivers",
      pickedUpOn: "28 May 2026",
      bookingId: "A-7MDEMOQ8ZPXN",
      total: "11.70",
      fare: "11.40",
      driver: "DEMO DRIVER B",
      passenger: "Farah Aziz",
      pickup: "KL Sentral Station",
      pickupTime: "8:15AM",
      dropoff: "Menara Demo, Jalan Ampang",
      dropoffTime: "8:31AM",
      tripSummary: "4.20 km • 16 mins",
    }),
  },
  // GrabPay in-store QR payment
  {
    messageId: "demo-msg-011",
    date: "2026-07-12",
    category: "payment",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "You've made a payment to Demo Kopi Bar 🎉",
    html: paymentReceiptHtml({
      merchant: "Demo Kopi Bar",
      orderAmount: "8.50",
      offer: "0.00",
      pointsUsed: "0.00",
      points: 0,
      total: "8.50",
      rewards: 8,
      paymentMethod: "GrabPay Wallet",
      transactionId: "d3e0a1b2c3d4e5f60718293a4b5c6d7e",
    }),
  },
  // GrabPay with an offer and points applied: Total (RM38.80), not Order
  // amount (RM45.00), is what gets exported.
  {
    messageId: "demo-msg-012",
    date: "2026-06-14",
    category: "payment",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "You've made a payment to Sample Mart Online 🎉",
    html: paymentReceiptHtml({
      merchant: "Sample Mart Online",
      orderAmount: "45.00",
      offer: "5.00",
      pointsUsed: "1.20",
      points: 120,
      total: "38.80",
      rewards: 38,
      paymentMethod: "GrabPay Wallet",
      transactionId: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    }),
  },
  // GrabPay online checkout — large enough that the demo total passes RM200,
  // so the RM200 spend-limit preset visibly cuts the list.
  {
    messageId: "demo-msg-013",
    date: "2026-07-19",
    category: "payment",
    fromHeader: GRAB_ERECEIPT_SENDER_HEADER,
    subject: "You've made a payment to Demo Games Store 🎉",
    html: paymentReceiptHtml({
      merchant: "Demo Games Store",
      orderAmount: "120.00",
      offer: "0.00",
      pointsUsed: "0.00",
      points: 0,
      total: "120.00",
      rewards: 120,
      paymentMethod: "PayLater",
      transactionId: "aa11bb22cc33dd44ee55ff6600778899",
    }),
  },
];
