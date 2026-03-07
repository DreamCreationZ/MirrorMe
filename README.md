# Brutal Stylist (MVP)

Fashion app MVP with:
- Login / signup / signout
- User personality/profile capture
- Closet inventory (tops, accessories, shoes, sandals, etc.)
- Occasion selector
- AI stylist chat with brutally honest verdicts + conversation memory
- Trust features: confidence score, why-it-works reasoning, alternatives, quick feedback, saved looks + wear history
- Stylist persona features: user can name stylist and switch between Chat mode and Talk mode
- Multilingual stylist replies with user language preference + honest makeup guidance
- Wardrobe intelligence: stylist considers recently worn vs long-not-worn items and recommends rotation honestly
- Full-look try-on support: send multiple outfit pieces (shirt/pants/saree/blouse etc.) from Stylist to Try-On for sequential overlay
- Wardrobe image normalization: uploaded garment photos are auto-cleaned and standardized for hanger-style presentation
- Optional studio-grade background removal for wardrobe uploads via remove.bg (`REMOVE_BG_API_KEY`)
- Virtual try-on API pipeline (mock + pluggable real provider)

## Stack
- Next.js (App Router) + TypeScript
- Firebase Auth + Firestore (env-based)
- OpenAI API for stylist chat

## Run
1. Install deps:
   ```bash
   npm install
   ```
2. Copy env:
   ```bash
   cp .env.example .env.local
   ```
3. Fill `OPENAI_API_KEY` and all `NEXT_PUBLIC_FIREBASE_*` values.
4. Start:
   ```bash
   npm run dev
   ```

## Flow
1. `/login` - create account or login
2. `/onboarding` - save profile details (height, skin tone, age, profession, etc.)
3. `/closet` - add inventory items or skip
4. `/occasion` - select occasion
5. `/stylist` - chat with AI stylist (memory + image upload)
6. `/try-on` - generate outfit overlay using configured provider

## Firebase behavior
- Login/Signup/Signout uses Firebase Auth.
- Profile and closet are also written to Firestore when configured.
- Stylist conversation memory and occasion are kept in localStorage per Firebase user ID.

## Honest stylist behavior
Configured in `app/api/stylist/route.ts` with strict tone rules:
- direct verdicts (`NOT GOOD`, `GOOD`, `BEST`)
- practical suggestions for color/silhouette/occasion fit
- uses saved user profile context (height, skin tone, age, profession, goals)
- supports outfit/user image inputs during chat
- no false praise

## Trust-first pilot features
- Every assistant response includes:
  - verdict
  - confidence score
  - why-this-works explanation
  - alternative options
  - time-saving tip
- Users can mark each suggestion as `Helpful` or `Not Useful`.
- Users can save recommendations as looks and mark them as worn later.
- Quick session feedback form is available inside the stylist screen.

## Virtual try-on realism
Current route is provider-agnostic (`app/api/tryon/route.ts`).
- `TRYON_PROVIDER=mock`: returns person image (dev mode)
- `TRYON_PROVIDER=fal_idm_vton`: calls fal queue API (`fal-ai/idm-vton`) and polls for final output
- `TRYON_PROVIDER=custom`: forwards to `TRYON_PROVIDER_API_URL` with bearer auth
- For `fal_idm_vton`, UI submits a job and polls status asynchronously (queued -> running -> completed).

### Try-on setup (real provider)
1. In `.env.local`, set:
   ```bash
   TRYON_PROVIDER=fal_idm_vton
   TRYON_PROVIDER_API_KEY=your_fal_key
   # optional override:
   # TRYON_PROVIDER_API_URL=https://queue.fal.run/fal-ai/idm-vton
   ```
2. Restart dev server.
3. Open `/try-on`, upload user photo and garment photo, then generate.

The app uploads selected images to Firebase Storage and sends public URLs to the try-on provider.
If `TRYON_PROVIDER=mock`, output will be the original user photo (no real overlay).
