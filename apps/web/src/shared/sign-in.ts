/** What the login form's action answers when it does not sign the visitor in. */
export interface SignInState {
  errorMessage: string | null;
  /** The username as typed, so a wrong password does not clear it. */
  username: string;
}
