import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Auth screen — README.md "Screens → 1. Auth (`/auth`)".
 * No topbar on this route. No password reset, no social providers.
 */
@Component({
  selector: 'app-auth-page',
  standalone: true,
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mode = this.auth.authMode;
  readonly pending = this.auth.pending;
  readonly error = this.auth.error;
  readonly isRegister = computed(() => this.mode() === 'register');

  readonly title = computed(() => (this.isRegister() ? 'Create your account' : 'Sign in'));
  readonly cta = computed(() => (this.isRegister() ? 'Create account' : 'Sign in'));
  readonly switchCopy = computed(() =>
    this.isRegister() ? 'Already have an account? Sign in' : 'No account yet? Create one',
  );

  readonly name = signal('');
  readonly email = signal('');
  readonly password = signal('');

  toggleMode(): void {
    this.auth.toggleAuthMode();
  }

  async submit(): Promise<void> {
    if (this.pending()) return;

    if (this.isRegister()) {
      await this.auth.register(this.name(), this.email(), this.password());
    } else {
      await this.auth.signIn(this.email(), this.password());
    }

    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }
}
