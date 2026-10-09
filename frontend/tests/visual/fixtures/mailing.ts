import { daysAgo } from "../clock";
import { emptyActivityCounts } from "../../../shared/activity";
import type {
  Audience,
  AudienceMember,
  CampaignRecord,
  Delivery,
} from "../../../shared/campaigns";

/** What /admin/mailing is answered with: the seeded owner and five accounts
 * that between them hit every row the page draws differently - a trial admin,
 * people who signed up, one who did not, one whose address nobody confirmed,
 * and one who has not been around for months. */

function member(
  uid: string,
  name: string,
  overrides: Partial<AudienceMember> = {},
): AudienceMember {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    displayName: name,
    admin: false,
    newAdmin: false,
    owner: false,
    createdAt: daysAgo(200),
    lastSignInAt: daysAgo(5),
    lastSeenAt: daysAgo(5),
    activity: { counts: emptyActivityCounts(), total: 0 },
    preferences: {},
    ...overrides,
  };
}

export const mailingAudience: Audience = {
  members: [
    member("test-admin", "Admin User", {
      email: "admin@koryta.pl",
      admin: true,
      owner: true,
      lastSeenAt: daysAgo(0),
      activity: {
        counts: { ...emptyActivityCounts(), vote: 37, revision: 4 },
        total: 41,
      },
    }),
    member("anna", "Anna Nowak", {
      admin: true,
      newAdmin: true,
      lastSeenAt: daysAgo(3),
      activity: { counts: { ...emptyActivityCounts(), vote: 12 }, total: 12 },
    }),
    member("piotr", "Piotr Zieliński", {
      lastSeenAt: daysAgo(9),
      preferences: { newsletter: { callsToAction: true, recentPeople: true } },
      activity: { counts: { ...emptyActivityCounts(), vote: 5 }, total: 5 },
    }),
    member("test-user", "Normal User", {
      email: "user@koryta.pl",
      lastSeenAt: daysAgo(2),
      preferences: {
        newsletter: { callsToAction: false, recentPeople: false },
      },
    }),
    member("ewa", "Ewa Wiśniewska", {
      emailVerified: false,
      lastSeenAt: daysAgo(14),
      preferences: { newsletter: { callsToAction: true } },
    }),
    member("kasia", "Kasia", {
      lastSeenAt: daysAgo(80),
      preferences: { newsletter: { callsToAction: true } },
    }),
  ],
  community: {
    days: 30,
    votes: 412,
    voters: 9,
    publications: 23,
    toCheck: 1204,
  },
  generatedAt: daysAgo(0, 10),
};

export const mailingCampaign: CampaignRecord = {
  id: "2026-08-31-pomozesz-sprawdzic-kilka-osob",
  subject: "Pomożesz sprawdzić kilka osób?",
  body: "Cześć,\n\nw kolejce czekają osoby, których nikt jeszcze nie sprawdził. Jedno sprawdzenie to kilka minut - [zobacz, jak to wygląda](/pomoc).\n\nDziękujemy, że jesteś z nami!\nZespół koryta.pl",
  ctaLabel: "Sprawdź kolejną osobę",
  ctaPath: "/eksploruj/nowe",
  topic: "callsToAction",
  includeStats: true,
  createdAt: daysAgo(1, 8),
  updatedAt: daysAgo(1, 9),
  createdBy: "test-admin",
  recipients: ["test-admin", "anna"],
  unsubscribed: [],
  sends: [
    {
      at: daysAgo(1, 8),
      by: "test-admin",
      test: true,
      outcomes: { queued: 1 },
    },
    {
      at: daysAgo(1, 9),
      by: "test-admin",
      test: false,
      outcomes: { queued: 2, noConsent: 1 },
    },
  ],
};

export const mailingDeliveries: Record<string, Delivery> = {
  "test-admin": {
    state: "SUCCESS",
    queuedAt: daysAgo(1, 9),
    finishedAt: daysAgo(1, 9),
    error: null,
  },
  anna: {
    state: "queued",
    queuedAt: daysAgo(1, 9),
    finishedAt: null,
    error: null,
  },
};
