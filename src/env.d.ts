declare namespace App {
  interface Locals {
    /** Started by getPageUser(), awaited by Layout.astro. See src/utils/pageAuth.ts. */
    onboardingProfile?: Promise<import('./utils/pageAuth').OnboardingProfile | null>;
  }
}
