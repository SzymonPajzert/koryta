"""What a company's supervisory organ is called, and whether sitting on it is a job.

koryta.pl counts the time somebody has spent in public institutions, and that
count is built from `employed` edges. Every seat rejestr.io reports as
``KRS_SUPERVISION`` becomes one, under a single label:
`scrapers.krs.list.KRS_RELATION_ROLES` maps that connection type to
"Rada Nadzorcza" for every company in the register.

For a spolka that is right. For the 243 `samodzielny publiczny zaklad opieki
zdrowotnej` hospitals it is not, and the register says so plainly - their
``dzial2.organNadzoru`` is named ``RADA SPOLECZNA``, never ``RADA NADZORCZA``.
A rada spoleczna is the advisory body art. 48 ustawy o dzialalnosci leczniczej
makes every SPZOZ appoint; its members are delegates of the founding body and
the local authorities, they meet a few times a year, and they are not paid for
it. So it is not employment in the sense the site tracks, any more than a seat
at a company nobody could show is publicly owned is - and 892 of them are
stored, across the 238 hospitals that have any, all labelled "Rada Nadzorcza".

The register is the evidence, but the *legal form* is the rule, and it is the
form this module reads. Two reasons: `Company.form` is already parsed and
already reaches the payload, so nothing new has to be crawled; and the
correspondence is not a coincidence to be sampled but the statute - an SPZOZ has
a rada spoleczna and cannot have a rada nadzorcza, because it is not a company
and has no shareholders to appoint one. Checked against the live register
anyway, for all 3,047 companies on the site that carry a supervisory seat: 238
of them are SPZOZ and all 238 name a rada spoleczna, and not one of the other
2,809 does.

What the site does with the answer is decided in
`frontend/shared/companyBodies.ts`, which owns the vocabulary and the display
titles the same way `frontend/shared/companyCategories.ts` owns the sectors.
This module only says which value applies.
"""

from entities.company_categories import SPZOZ, matches_form

#: The ordinary supervisory board of a spolka. Not currently emitted - a payload
#: says nothing rather than claiming this - but named because it is what the
#: stored edges mean and what the site displays when nothing says otherwise.
RADA_NADZORCZA = "rada-nadzorcza"

#: The advisory body of an SPZOZ. Unpaid, so a seat on it is not employment.
RADA_SPOLECZNA = "rada-spoleczna"

#: Legal form -> what that form's supervisory organ is called.
#:
#: Only forms whose organ is *not* an ordinary rada nadzorcza belong here. The
#: register holds others - a cech and an izba rzemieslnicza are supervised by a
#: ``KOMISJA REWIZYJNA``, an izba gospodarcza by a ``RADA IZBY``, and those are
#: unpaid too - but no such seat is stored on the site today, so adding them
#: would be a rule with nothing to apply it to. When one arrives, it is a line
#: here and a value in `companyBodies.ts`.
SUPERVISORY_BODY_BY_FORM: dict[str, str] = {
    SPZOZ: RADA_SPOLECZNA,
}


def form_for_supervisory_body(body: str | None) -> str | None:
    """The register form a stored supervisory body implies, or `None`.

    The inverse of `SUPERVISORY_BODY_BY_FORM`, and it lives here so the two
    cannot drift. It exists for the one caller that has a node rather than a
    register entry - `analysis.payloads.company.SiteCompanyCategories` reads the
    site's export, which stores the organ and not the form it came from.

    Only an injective mapping can be inverted. Today's has one entry, so the
    question does not arise; if two forms ever share an organ this returns
    `None` for that organ rather than guessing, which costs those companies a
    form-derived category in the catch-up producer and nothing else.
    """
    if not body:
        return None
    matches = [
        form for form, known in SUPERVISORY_BODY_BY_FORM.items() if known == body
    ]
    return matches[0] if len(matches) == 1 else None


def supervisory_body(form: str | None) -> str:
    """What this company's supervisory organ is called, for the ingest payload.

    Returns the empty string where the form is one whose organ this module has
    nothing special to say about - which is every spolka, and the whole of the
    register bar the forms in `SUPERVISORY_BODY_BY_FORM`. Empty is a real
    answer and the ingest clears any stored value on it, exactly as an empty
    `categories` list means "in no sector we track" rather than "not computed";
    a payload that never worked the field out omits it and leaves the node
    alone. See `frontend/server/api/ingest/company.post.ts`.

    A missing `form` therefore also yields the empty string, which is safe in
    the direction that matters: a company whose form nobody read keeps counting
    its supervisory seats as employment, which is what the site did before this
    module existed.
    """
    for known, body in SUPERVISORY_BODY_BY_FORM.items():
        if matches_form(form, (known,)):
            return body
    return ""
