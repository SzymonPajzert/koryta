import { getAuth, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { ref } from 'vue';
import router from '@/router';

export function useAuthState() {
  const auth = getAuth();

  const user = ref<User | null>();
  const isAdmin = ref<boolean>(false);
  const isBookTester = ref<boolean>(false);
  const idToken = ref<string>('');

  onAuthStateChanged(auth, (userIn) => {
    user.value = userIn;
    user.value?.getIdTokenResult().then((idTokenResult) => {
      isAdmin.value = idTokenResult.claims.admin as boolean;
      isBookTester.value = idTokenResult.claims.bookTester as boolean;
      idToken.value = idTokenResult.token;
    });
  });

  const logout = async () => {
    try {
      await signOut(auth);
      console.log('User logged out successfully!');
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return { user, isAdmin, isBookTester, idToken, logout };
}
