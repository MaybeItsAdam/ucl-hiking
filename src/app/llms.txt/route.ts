import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

export const dynamic = "force-static";

/** llmstxt.org summary for AI assistants that cite the club. */
export function GET() {
  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

UCL Hiking Club is a student club of Students' Union UCL (University College London), based in London. It runs weekend walks out of London and mountain weekends. Membership is bought through the Students' Union (https://studentsunionucl.org/clubs-societies/hiking-club); tiers are Taster, Standard and Explorer.

Members sign in with their UCL account, on the website or in the UCL Hiking Club app for iOS and Android. Signed in, they get the walk programme (distance, total ascent, difficulty grade, train and fare, meeting point and time, leaders), the club's route library on Ordnance Survey maps with elevation profiles and GPX downloads, club kit hire, The Navigator (the club magazine), a subscribable walk calendar and walk-leader tools.

## Pages

- [Home](${SITE_URL}/): what the club is and how to sign in
- [Upcoming walks](${SITE_URL}/walks): walks open to everyone, with date, distance, meeting time and place, and ticket links on the Students' Union website
- [App support](${SITE_URL}/support): help with UCL sign-in, membership, equipment requests and the mobile app
- [Privacy policy](${SITE_URL}/privacy): what the website and app collect and how to delete it
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
