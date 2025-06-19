<script setup lang="ts">
import { ref } from 'vue';
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, type User, onAuthStateChanged } from 'firebase/auth';
import router from '@/router';
import { auth, db } from '@/firebase';
import { set, ref as dbRef } from 'firebase/database';

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

const user = ref<User | null>();
onAuthStateChanged(auth, (userIn) => {
  user.value = userIn
  set(dbRef(db, `user/${userIn?.uid}/displayName`), userIn?.displayName)
  set(dbRef(db, `user/${userIn?.uid}/email`), userIn?.email)
  set(dbRef(db, `user/${userIn?.uid}/photoURL`), userIn?.photoURL)
});

const login = async () => {
  error.value = null;
  loading.value = true;
  try {
    const auth = getAuth();
    await signInWithEmailAndPassword(auth, email.value, password.value);
    // User is signed in.
    console.log('User logged in successfully!');
    router.push('/')
  } catch (err: any) {
    console.error('Login error:', err.code, err.message);
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const loginWithGoogle = async () => {
  error.value = null;
  loading.value = true;
  try {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    console.log('User logged in with Google successfully!');
    router.push('/')
  } catch (err: any) {
    console.error('Google login error:', err.code, err.message);
    error.value = getErrorMessage(err.code);
  } finally {
    loading.value = false;
  }
};

const getErrorMessage = (errorCode: string) => {
  switch (errorCode) {
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/user-disabled':
      return 'This user account has been disabled.';
    case 'auth/user-not-found':
      return 'User not found.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/popup-closed-by-user':
      return 'Login popup was closed by user.';
    case 'auth/cancelled-popup-request':
      return 'Login popup request was cancelled.';
    case 'auth/popup-blocked':
      return 'Login popup was blocked by the browser.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
};
</script>

<template>
  <main v-if="user">
    Cześć {{ user?.displayName }}!
  </main>
  <main v-if="!user">
    <h2 class="blue">Zaloguj się</h2>
    <v-form @submit.prevent="login">
      <div class="form-group">
        <button type="button" @click="loginWithGoogle" :disabled="loading" class="google-button">
          <span v-if="loading">Logging in...</span>
          <span v-else>Zaloguj się z Google</span>
        </button>
      </div>

      <v-expansion-panels>
        <v-expansion-panel>
          <v-expansion-panel-title>
            Zaloguj się za pomocą maila
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            Tylko dla osób z discorda z założonym kontem.
            <div class="form-group">
              <label for="email">Email:</label>
              <input type="email" id="email" v-model="email" required />
            </div>
            <div class="form-group">
              <label for="password">Hasło:</label>
              <input type="password" id="password" v-model="password" required />
            </div>
            <div class="form-group">
              <button type="submit" :disabled="loading">
                <span v-if="loading">Logging in...</span>
                <span v-else>Wyślij</span>
              </button>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </v-form>
  </main>
</template>

<style scoped>
/* Basic styling to resemble a form, adapt to your submitview's style */
.login-view {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.form-group {
  margin-bottom: 15px;
}

label {
  display: block;
  margin-bottom: 5px;
}

input[type='email'],
input[type='password'] {
  width: 100%;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  box-sizing: border-box;
}

button {
  background-color: #4caf50; /* Example color, change to match submitview */
  color: white;
  padding: 10px 15px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

.error-message {
  color: red;
  margin-top: 10px;
}

.google-button {
  background-color: #db4437; /* Google red */
  margin-top: 10px;
}
</style>
