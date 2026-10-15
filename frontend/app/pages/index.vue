<template>
  <HomeSection color>
    <!-- One h1 at every width: the sentence that says what the site does.
         It used to be two - a claim beside the logo on a computer, this
         sentence on a phone - and the claim was a heading nobody could act
         on, three lines of it at 60px. Now the search sits right under the
         sentence it answers, on the same left edge, and the logo steps down
         beside both rather than above them. -->
    <div class="home-hero">
      <!-- Desktop only. On a phone the logo would be most of the first screen
           and is not something a reader can act on; the app bar has it. -->
      <!-- To /pomoc, not to the zrzutka. This used to open a particular
           reward on the fundraiser - a limited pin - which is spent, so the
           first thing on the page sent a reader to a finished appeal. /pomoc
           is where the current ask lives and stays right as it changes. Same
           goal as the "Działaj z nami" button below, told apart by `from`. -->
      <NuxtLink
        to="/pomoc"
        class="home-hero__logo d-none d-md-block"
        @click="trackGoal('cta:pomoc', { from: 'home-logo' })"
      >
        <NuxtImg
          width="136"
          height="136"
          src="/logo.png"
          class="d-block"
          fetchpriority="high"
          preload
          alt="Koryta.pl logo"
        />
      </NuxtLink>
      <div class="home-hero__main">
        <!-- Full emphasis, not medium: this sits on the green band, where
             rgba(0,0,0,.6) is the wrong side of readable. 48 on a computer,
             the one display title on the site; 24 on a phone (type.css). -->
        <h1 class="k-title--display text-high-emphasis mb-0">
          Sprawdzamy, którymi stanowiskami w&nbsp;publicznych spółkach
          podzielili się politycy
        </h1>
        <!-- Search and button in one wrapping flex line rather than an 8/4
             grid. The grid put them in columns with different padding, so on a
             phone, where the columns stack, the button sat 20px to the left of
             the search bar above it, and on a desktop it started at the 8/12
             mark - a gap wide enough to read as a stray control rather than as
             the search's companion. Wrapping puts it under the search on a
             phone, at the same left edge, and beside it everywhere else. -->
        <div class="home-actions d-flex flex-wrap align-center ga-4">
          <omni-search />
          <!-- Desktop only. Wrapped under a full width search field it read as
               a stray control rather than as the search's companion, and on a
               phone the first screen is better spent getting the reader to the
               map than to a second call to action. The app bar carries the
               same link on a desktop; the footer is where a phone finds it.
               No `border`: the fill sets it off the band, and a control
               carries no line - at the site's .24 hairline it had become a
               brownish ring round the pink. -->
          <v-btn
            :append-icon="mdiChevronRight"
            color="secondary"
            class="text-none d-none d-md-inline-flex"
            flat
            rounded="lg"
            slim
            text="Działaj z nami"
            to="/pomoc"
            data-testid="home-cta"
            @click="trackGoal('cta:pomoc', { from: 'home-hero' })"
          />
        </div>
      </div>
    </div>
  </HomeSection>
  <HomeSection>
    <HomeExplorer />
  </HomeSection>
  <!-- No `v-row`/`v-col` around it: the call to action is a card of its own
       now rather than centred loose text, and the old nest stacked five
       paddings - this row, HomeSection's container, and the component's own. -->
  <HomeSection>
    <!-- The newsletter for readers without an account, asked first, above
         the call to action. The gap goes under it, not over it: the section
         already stands the sections' gap below the one above. Inside the
         section, so a signed-in reader, who does not get the form, gets no
         empty gap either. -->
    <MailNewsletterSignupForm class="mb-4 mb-md-6" />
    <CardCallToAction />
  </HomeSection>
  <!-- Last on the page, and it has to be: the feed keeps growing as the reader
       scrolls, so anything below it is pushed further away every time it does. -->
  <!-- Everything the site has just learned, in one date-ordered list: posts
       taken up, round numbers of years served, and whatever gets found next. -->
  <HomeSection end>
    <HomeEventFeed />
  </HomeSection>
</template>

<script setup lang="ts">
import { mdiChevronRight } from "@mdi/js";
import { trackGoal } from "~/composables/analytics";
import { SOCIAL_CARD } from "~/composables/entitySeo";

useSeoMeta({
  title: "Największy, niezależny agregator koryciarstwa",
  description:
    "Jesteśmy największym, ogólnopolskim, niezależnym agregatorem koryciarstwa. Sprawdź którymi stanowiskami w publicznych spółkach podzielili się politycy.",
  ogTitle: "Największy, niezależny agregator koryciarstwa",
  ogDescription:
    "Jesteśmy największym, ogólnopolskim i niezależnym agregatorem koryciarstwa. Sprawdź którymi stanowiskami w publicznych spółkach podzielili się politycy.",
  // logo.png is 5906px square and 1.4 MB - cropped to a circle by every
  // platform that accepts it at all. social-card.png is the 1200x630 they ask
  // for.
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});

definePageMeta({
  affineLink: "7CDdAj6z8PUAFNWT-phhD",
  fullWidth: true,
  // The bands run edge to edge, the content in them on HomeSection's 1200
  // column - which the signed-in strip under the app bar lines up with, as
  // it does with every other page's.
  columnWidth: 1200,
  hideSearch: true,
});
</script>

<style scoped>
/* The band's own padding is HomeSection's, 16px on a phone and 28 from 960
   up; the hero adds to it. On a phone that makes 32 on every side, as before.
   On a computer it is 56 above and 48 below, so the band is as tall as its
   sentence and the search under it: 286px at 1440, where the old claim kept
   it at 426. */
.home-hero {
  padding: 16px;
}

.home-actions {
  margin-top: 16px;
}

/* OmniSearch's root is `display: contents`, so the field itself is the flex
   item on this line - which is why the `width: 400px` this page used to pass
   never took, `.v-input` being `flex: 1 1 auto` and free to grow past it.
   Sizing it as the flex item is what holds: it fills the line on a phone and
   stops at the width the search was always meant to have. The basis is below
   the narrowest phone, so the button wraps under it rather than squeezing it.
   No margin of its own: it starts on the h1's left edge. */
.home-actions :deep(.v-input) {
  flex: 1 1 280px;
  max-width: 400px;
  margin: 0 !important;
}

@media (min-width: 960px) {
  /* The logo in a column of its own beside the sentence and the search,
     centred on the two of them. Its left edge is the page's content edge,
     where the call to action and the footer start too. */
  .home-hero {
    display: grid;
    grid-template-columns: 136px minmax(0, 1fr);
    column-gap: 48px;
    align-items: center;
    padding: 28px 0 20px;
  }

  .home-actions {
    margin-top: 28px;
  }

  /* Two thirds of the line, which is where the 8/12 column this row replaced
     used to end. Capped at 400px the search stopped a third of the way
     across, and "Działaj z nami" - which is meant to read as its companion -
     started near the middle of an otherwise empty line, looking like a
     control that had come loose. The proportion is what matters here rather
     than a pixel width: the section around it is capped at 1200px and
     centred. */
  .home-actions :deep(.v-input) {
    max-width: 66%;
  }
}
</style>
