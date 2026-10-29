import type { NextConfig } from "next";

type RedirectItem = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/**
 * Legacy URL redirects imported from Wix URL Redirects export.
 * These preserve shortlinks, forms, media links, and legacy blog/category paths.
 */
export const legacyRedirects: RedirectItem[] = [
  {
    source: "/e/WL/about",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club#BasicsofbeingaWalkLeader:~:text=HELP%20US%20OUT%20AS%20A%20WALK%20LEADER%3A",
    permanent: true,
  },
  {
    source: "/merch",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club/products",
    permanent: true,
  },
  {
    source: "/e/WL/WalkLeader101",
    destination: "https://liveuclac-my.sharepoint.com/:w:/g/personal/zcemvth_ucl_ac_uk/IQCDib9pdBgDQpAi1kd7vYzwAQOeyEKy8Ri4mL-u2ROZSbs?e=IvR237",
    permanent: true,
  },
  {
    source: "/e/WL/first-aid-attendance",
    destination: "https://forms.office.com/Pages/ResponsePage.aspx?id=_oivH5ipW0yTySEKEdmlwtYWGTJ9bnNEgMEScGEizBRUNFhFQjJMTTFSVElBTEtYVzRMUjhYWEpHNi4u",
    permanent: true,
  },
  {
    source: "/e/feedback",
    destination: "https://forms.gle/y1xoSeErSeUZ2mYN7",
    permanent: true,
  },
  {
    source: "/e/82191/dev-plan",
    destination: "https://liveuclac-my.sharepoint.com/:x:/r/personal/zcemvth_ucl_ac_uk/Documents/UCL%20Hiking%20Club%202025-26/Admin/Development%20Plan%202025-26.xlsx?csf=1&d=wd1cddbb2d90343c2847cc0fb21d24250&e=ttGUIO&web=1",
    permanent: true,
  },
  {
    source: "/media/socials",
    destination: "https://photos.app.goo.gl/2M58bZnmY5Wy2SZ39",
    permanent: true,
  },
  {
    source: "/e/82191/logins",
    destination: "https://liveuclac-my.sharepoint.com/:x:/r/personal/zcemvth_ucl_ac_uk/Documents/UCL%20Hiking%20Club%202025-26/Admin/Logins%2025-26.xlsx?csf=1&d=w72aeaf91c5d34d309aad23207353dc12&e=e4SkXt&web=1",
    permanent: true,
  },
  {
    source: "/e/WL/fleeces",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSfBjzunUNRsgYiDAZTQcofOLJcIj69rD604V-Dom384ozqVSA/viewform?entry.1835532962=No&entry.2074204700=Purchase+of+a+UCL+Hiking+Club+fleece,+with+partial+reimbursement+of+only+%C2%A37.00+as+part+of+the+Walk+Leader+volunteer+team+discount.+&entry.2093295632=7.00&usp=pp_url",
    permanent: true,
  },
  {
    source: "/e/navigator/2",
    destination: "https://drive.google.com/file/d/1TDlQ2PB-vZKL5EWHPxxCX4R7VWszUiJz",
    permanent: true,
  },
  {
    source: "/e/affiliate-member-info",
    destination: "https://studentsunionucl.org/clubs-societies/visiting-associate-membership",
    permanent: true,
  },
  {
    source: "/events",
    destination: "/e/events",
    permanent: true,
  },
  {
    source: "/e/WL/travel",
    destination: "/e/WL/reimbursement",
    permanent: true,
  },
  {
    source: "/media/vt",
    destination: "https://drive.google.com/drive/folders/1v6ihmTsim1BNgfmo_lR7481ZKrzoQY43?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/WL/first-aid-first-date",
    destination: "https://forms.office.com/Pages/ResponsePage.aspx?id=_oivH5ipW0yTySEKEdmlwtYWGTJ9bnNEgMEScGEizBRUNFhFQjJMTTFSVElBTEtYVzRMUjhYWEpHNi4u",
    permanent: true,
  },
  {
    source: "/media/trips/dales",
    destination: "https://photos.app.goo.gl/fMYpnBuYXBEbJ1zK8",
    permanent: true,
  },
  {
    source: "/e/82191/calendar",
    destination: "https://docs.google.com/spreadsheets/d/16MiP5dUeHTlARhZnr907YlssCcGi5_51Eq-QmsOP0q8/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/app-calendar",
    destination: "https://calendar.google.com/calendar/u/0?cid=ODQwMDc5NzVjNjBhZmYxNDIwYjY2ZDczMzNiZGU4ZjgzODAwMGRlOGNjNmE4NGQwZDYxNTBkODA4NmJlYWU3MkBncm91cC5jYWxlbmRhci5nb29nbGUuY29t",
    permanent: true,
  },
  {
    source: "/media/project-active-walks",
    destination: "https://photos.app.goo.gl/Y55eehZWR9BMxJzt9",
    permanent: true,
  },
  {
    source: "/e/whats-on",
    destination: "https://studentsunionucl.org/whats-on?e=2025-11-09&s=2025-09-08&t=Hiking&v=list",
    permanent: true,
  },
  {
    source: "/e/WL/calendar",
    destination: "https://docs.google.com/spreadsheets/d/1ZTBj6SIUDf2vBzHbXm2Kdjx4uPNMweUasSc-OW5m1jw/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/subcommittee",
    destination: "https://liveuclac-my.sharepoint.com/:w:/g/personal/zcemvth_ucl_ac_uk/ETNfTADWsX1LrByeROOkXAMBSXuUNfSCjhE5jj0dsDe__w",
    permanent: true,
  },
  {
    source: "/e/82191/onedrive",
    destination: "https://liveuclac-my.sharepoint.com/:f:/r/personal/zcemvth_ucl_ac_uk/Documents/UCL%20Hiking%20Club%202025-26?csf=1&e=MYsrM1&web=1",
    permanent: true,
  },
  {
    source: "/e/82191/planner",
    destination: "https://docs.google.com/spreadsheets/d/16MiP5dUeHTlARhZnr907YlssCcGi5_51Eq-QmsOP0q8/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/oyster-card",
    destination: "https://tfl.gov.uk/fares/free-and-discounted-travel/national-railcard-discount",
    permanent: true,
  },
  {
    source: "/e/new-member",
    destination: "https://studentsunionucl.org/whats-on/clubs-societies/new-members-info-not-event",
    permanent: true,
  },
  {
    source: "/media/trips/iow-drive",
    destination: "https://drive.google.com/drive/folders/19wHf02zyUFI4ROx1INRyJlHFdzvNI89K",
    permanent: true,
  },
  {
    source: "/media/trips/iow",
    destination: "https://photos.app.goo.gl/Gxe39L12eA5xkUhT7",
    permanent: true,
  },
  {
    source: "/e/media/hikes",
    destination: "/media/hikes",
    permanent: true,
  },
  {
    source: "/e/trip/romania/travel",
    destination: "https://docs.google.com/document/d/1d1SYMnnxAuO8_FOffD-H5IAbYgEwRmQJfPr_GmbPKnU/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/trips/lakes",
    destination: "https://studentsunionucl.org/whats-on/events-activities/club-trip-1-lake-district",
    permanent: true,
  },
  {
    source: "/e/FAQs",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club#MembershipFAQs",
    permanent: true,
  },
  {
    source: "/e/roles",
    destination: "https://docs.google.com/document/d/1RHkmrELFpuLyzZ8HUHThyiuhHOLnPYcXT2-RgyhCIos/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/hike",
    destination: "/h",
    permanent: true,
  },
  {
    source: "/e/WL/join",
    destination: "https://forms.gle/QZgWSBZWksno5Rj38",
    permanent: true,
  },
  {
    source: "/single-post/2018/01/31/We-need-to-talk-about-boots\u2026",
    destination: "/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6",
    permanent: true,
  },
  {
    source: "/single-post/2018/01/31/We-need-to-talk-about-boots%E2%80%A6",
    destination: "/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6",
    permanent: true,
  },
  {
    source: "/single-post/2018/01/31/We-need-to-talk-about-boots%e2%80%a6",
    destination: "/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6",
    permanent: true,
  },
  {
    source: "/e/WL/trainingquiz",
    destination: "https://forms.office.com/Pages/ResponsePage.aspx?id=_oivH5ipW0yTySEKEdmlwtYWGTJ9bnNEgMEScGEizBRUREZQM01ETEI2MDVRMVcyVVJWTUtZNVZHQS4u",
    permanent: true,
  },
  {
    source: "/e/trip-signup",
    destination: "https://forms.gle/vT96Jqj3DC9TdLMz6",
    permanent: true,
  },
  {
    source: "/e/su-homepage",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club",
    permanent: true,
  },
  {
    source: "/e/WL/first-aid",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSd6xnzD_MbI6NeiUwA7Dp9JAZ3qiG6Kc3vYD_qlnk5jxNKNsQ/viewform?usp=preview",
    permanent: true,
  },
  {
    source: "/media/walk-leaders",
    destination: "https://photos.app.goo.gl/LXbsgogEksu1wu7aA",
    permanent: true,
  },
  {
    source: "/e/membership",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club#ComparisonDiscovererDSvsExplorerXP",
    permanent: true,
  },
  {
    source: "/e/navigator/1",
    destination: "https://drive.google.com/file/d/1uW8CImkdw_h0-RW_aUxKeByXKPQu1X02/view?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/join",
    destination: "https://studentsunionucl.org/group/82191#:~:text=Contact%20and%20info,-President",
    permanent: true,
  },
  {
    source: "/e/trip/romania",
    destination: "https://studentsunionucl.org/whats-on/clubs-societies/club-trip-5-romania",
    permanent: true,
  },
  {
    source: "/e/bake-sale",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSf_j1q-Ro63M4eqP8pMHVxtUCbbxL_LlhLjLc5CgyzT0s87gQ/viewform?usp=dialog",
    permanent: true,
  },
  {
    source: "/e/fleece",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSdyvtwYg-JJsHEgNaFeEV4FRfIy453ja9puyVq6ti1ibz-j3Q/viewform?usp=header",
    permanent: true,
  },
  {
    source: "/e/trip/chamonix/travel",
    destination: "https://docs.google.com/document/d/1mfkJzfBlWRtQpb2RRfto7lLuh3kTPDvLQBJFfDQ0cug/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/events",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club/events",
    permanent: true,
  },
  {
    source: "/e/taster-chat3",
    destination: "https://chat.whatsapp.com/HD3TvQRBS9hKB6No2dGDt7",
    permanent: true,
  },
  {
    source: "/e/su-visiting",
    destination: "https://studentsunionucl.org/clubs-societies/visiting-associate-membership",
    permanent: true,
  },
  {
    source: "/media/hikes",
    destination: "https://photos.app.goo.gl/RGhk5pBjeWWW4DJT9",
    permanent: true,
  },
  {
    source: "/e/participation-fund",
    destination: "https://studentsunionucl.org/advice-and-support/support/participation-fund-contact-form",
    permanent: true,
  },
  {
    source: "/e/82191/fleeces",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSfBjzunUNRsgYiDAZTQcofOLJcIj69rD604V-Dom384ozqVSA/viewform?entry.1835532962=No&entry.2074204700=Purchase+of+a+customised+committee+UCL+Hiking+Club+fleece,+with+partial+reimbursement+of+only+%C2%A319.00+as+part+of+the+agreed+committee+discount.&entry.2093295632=19.00&usp=pp_url",
    permanent: true,
  },
  {
    source: "/e/expenses-form",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSfsfv0g1M0MqPI1yYQq23ZU6glDaD9ptiMS38FIC2wNJDqAQA/viewform",
    permanent: true,
  },
  {
    source: "/e/WL/InterestContinued",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSecByunmCzBqQTujX8D-dekb_YhV7B9hYUtSGI4fFlHCBIWPw/viewform?usp=header",
    permanent: true,
  },
  {
    source: "/e/links",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club#QUICKLINKS",
    permanent: true,
  },
  {
    source: "/feedback",
    destination: "/e/feedback",
    permanent: true,
  },
  {
    source: "/e/su-alumni",
    destination: "https://studentsunionucl.org/clubs-societies/visiting-associate-membership",
    permanent: true,
  },
  {
    source: "/e/WL/route-feedback",
    destination: "https://forms.gle/FoHDaurVxcoumqM26",
    permanent: true,
  },
  {
    source: "/e/railcard",
    destination: "https://www.16-25railcard.co.uk",
    permanent: true,
  },
  {
    source: "/e/82191/central-calendar",
    destination: "https://docs.google.com/spreadsheets/d/16MiP5dUeHTlARhZnr907YlssCcGi5_51Eq-QmsOP0q8/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/WL/FAQs",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club#WalkLeaderFAQs",
    permanent: true,
  },
  {
    source: "/e/trip/cornwall",
    destination: "https://studentsunionucl.org/whats-on/clubs-societies/club-trip-6-cornwall",
    permanent: true,
  },
  {
    source: "/e/882bc3",
    destination: "https://chat.whatsapp.com/LR485BpD1r9550ja5Jy3NL",
    permanent: true,
  },
  {
    source: "/e/redirect",
    destination: "https://manage.wix.com/dashboard/7387a860-1ad7-4c90-8756-85fd6dd91078/seo-home/redirects?referralInfo=seo-home",
    permanent: true,
  },
  {
    source: "/media/trips/snowdonia",
    destination: "https://photos.app.goo.gl/jkJ3mQqc6HTmGpuP9",
    permanent: true,
  },
  {
    source: "/r/logo",
    destination: "https://static.wixstatic.com/media/29bf68_d35a95bd306f4fd3be0f62c75d569c4e~mv2.png",
    permanent: true,
  },
  {
    source: "/wl",
    destination: "https://linktr.ee/ucl_walk_leaders",
    permanent: true,
  },
  {
    source: "/e/WL/hike-sign-up-old",
    destination: "https://liveuclac-my.sharepoint.com/:x:/r/personal/zcfarok_ucl_ac_uk/Documents/UCL%20Hiking%20Club%202024-25/2024-25%20Committee/Weekend%20Hikes/Activity%20Programme%202024_25%20UPDATED.xlsx?csf=1&d=w69b11649475e4b48a614000234e6924f&e=ZUc85M&web=1",
    permanent: true,
  },
  {
    source: "/e/WL/hike-sign-up",
    destination: "https://docs.google.com/spreadsheets/d/1ZTBj6SIUDf2vBzHbXm2Kdjx4uPNMweUasSc-OW5m1jw/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/e/fleece-preview",
    destination: "https://liveuclac-my.sharepoint.com/:b:/g/personal/zcemvth_ucl_ac_uk/EbUVKp3p-QdKgGJG2evjtOEBuVxkn0J0bTI2X8U3DpQSTw?e=bj86mz",
    permanent: true,
  },
  {
    source: "/e/calendar",
    destination: "https://calendar.google.com/calendar/u/0?cid=ODQwMDc5NzVjNjBhZmYxNDIwYjY2ZDczMzNiZGU4ZjgzODAwMGRlOGNjNmE4NGQwZDYxNTBkODA4NmJlYWU3MkBncm91cC5jYWxlbmRhci5nb29nbGUuY29t",
    permanent: true,
  },
  {
    source: "/e/WL/CoreRiskAssessment",
    destination: "https://studentsunionucl.org/sites/default/files/2024-07/Hiking%20%5BJune%202024%5D%20Core%20Risk%20Assessment.xlsx",
    permanent: true,
  },
  {
    source: "/e/WL/hats",
    destination: "https://studentsunionucl.org/product/ucl-hiking-club-branded-red-caps-walk-leaders-only",
    permanent: true,
  },
  {
    source: "/e/WL/reimbursement",
    destination: "https://docs.google.com/forms/d/e/1FAIpQLSd99Fn-IUpgDbdftMv9E8njDjkshvV5Qkfe_KEYgyadweZSSw/viewform?usp=header",
    permanent: true,
  },
  {
    source: "/e/instagram",
    destination: "https://www.instagram.com/uclhiking",
    permanent: true,
  },
  {
    source: "/e/trip/chamonix",
    destination: "https://studentsunionucl.org/whats-on/clubs-societies/club-trip-4-chamonix",
    permanent: true,
  },
  {
    source: "/e/kitlist",
    destination: "https://docs.google.com/spreadsheets/d/1pR5hy96TQko2eGJO_lxkcYeIrnOnSBQF2lOV-SRnvFg/edit?usp=sharing",
    permanent: true,
  },
  {
    source: "/single-post/:path*",
    destination: "/post/:path*",
    permanent: true,
  },
  {
    source: "/category/:path*",
    destination: "/blog-1/categories/:path*",
    permanent: true,
  },
];
