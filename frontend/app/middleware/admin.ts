import type { User } from "firebase/auth"

export default defineNuxtRouteMiddleware(async () => {
  const user: User = await getCurrentUser()
  if (!user)
    return navigateTo('/login', { replace: true })
  const idTokenResult = await user.getIdTokenResult()
  if (!idTokenResult.claims.admin) {
    return false
  }
})
