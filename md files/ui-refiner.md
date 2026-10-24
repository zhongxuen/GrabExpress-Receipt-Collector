# Task: Refine Receipt Scraper & Compiler UI

## Project Context
- **Tech stack**: Next.js (App Router), Vercel deployment, GitHub
- **Purpose**: Receipt scraper that extracts data from uploaded receipt images (date, merchant, amount, items) and compiles them into organized records
- **Current state**: Basic functional UI — needs polish, usability improvements, and visual appeal

## Your Goal
Refine the entire UI to be modern, user-friendly, and visually polished. Make it feel like a professional tool, not a hobby project.

## UI Requirements

### 1. Layout & Navigation
- Clean dashboard-style layout with sidebar or top navigation
- Clear visual hierarchy: Upload → Process → View/Manage → Export
- Show recent receipts prominently on the dashboard

### 2. Upload Experience (Priority 1)
- **Drag-and-drop zone** with visual feedback (highlight on drag)
- **Click-to-upload** fallback (standard file input, styled)
- Show **file preview** (thumbnail) before processing
- **Upload progress** indicator (not just spinner — show % or step status)
- Support: JPEG, PNG, PDF, HEIC (convert HEIC to JPEG)

### 3. Date Input (Priority 2) — Fix the date inputter
- Replace plain text input with:
  - **Date picker** (calendar popup) with keyboard navigation
  - **Quick buttons**: "Today", "Yesterday", "This Week", "Last 7 Days"
  - **Auto-detect date** from receipt → fallback to picker if uncertain
  - **Date format**: DD/MM/YYYY (user's locale) → store as ISO (YYYY-MM-DD)
- Show **validation feedback** instantly (invalid date → red border + tooltip)

### 4. Receipt Data Display
- **Card grid** for receipts (not a boring table)
- Each card: merchant name, date, amount, item count
- **Color-coding** by category (Food, Transport, Shopping, Utilities, Other)
- **Search bar**: search by merchant, date range, or category
- **Sort controls**: sort by date (newest first default), amount, merchant A-Z

### 5. Compilation / Summary View
- **Monthly overview**: bar chart or simple stats (total spent, category breakdown)
- **Export options**: CSV, PDF, JSON
- **Batch actions**: select multiple receipts → delete or export

### 6. Mobile Responsiveness
- Fully responsive: mobile-first design
- Touch-friendly buttons (min 44px tap targets)
- Swipe gestures (optional: swipe to delete on cards)

### 7. Feedback & States
- **Loading state**: skeleton placeholders, not a white screen
- **Success state**: toast notification + animated confirmation
- **Error state**: clear error message with next-step guidance
- **Empty state**: friendly illustration + "Upload your first receipt" CTA

### 8. Visual Design
- **Color palette**: Use the existing brand colors or propose a clean set (e.g., slate/indigo/emerald)
- **Typography**: Clean, readable font (Inter or Geist)
- **Spacing**: Generous whitespace, consistent spacing scale
- **Shadows**: Subtle depth (elevation hierarchy)
- **Icons**: Use a consistent icon set (Lucide or Heroicons)
- **Animations**: Subtle micro-interactions (hover scale, fade-in, smooth transitions)

## Technical Constraints
- Use the existing Next.js 14+ App Router
- Use Tailwind CSS for styling
- Prefer shadcn/ui components where available (or build custom with Tailwind)
- Maintain existing API routes (don't break the backend)
- Keep the code modular and well-organized

## Deliverables
1. Updated layout components (`app/layout.tsx`, sidebar/nav)
2. Upload component (drag-and-drop + progress)
3. Date input component with picker + quick buttons
4. Receipt card grid with search + filter + sort
5. Dashboard summary view (stats + chart)
6. Empty/loading/error states
7. Mobile responsiveness fixes

## Design References
- Modern receipt apps: Expensify, Receipt Hog, Shoeboxed
- UI inspiration: Linear, Raycast, Notion
- Keep it **clean, minimal, and functional** — not over-designed