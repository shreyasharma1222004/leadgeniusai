import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import { ArrowRight, Loader2, Mail, Sparkles, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/leads",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Couldn't start a guest session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Left: brand panel */}
      <div className="relative hidden flex-col justify-between border-r border-border bg-[#141414] p-10 text-[#F5F1E8] lg:flex">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="DealFlow AI" className="size-7 rounded-md" />
          <span className="text-sm font-semibold tracking-tight">
            DealFlow<span className="text-[#A9E813]"> AI</span>
          </span>
        </Link>
        <div>
          <p className="label-caps text-[#F5F1E8]/50">AI-powered sales</p>
          <h1 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            Find the right leads. Say the right thing. Follow up at the right
            time.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#F5F1E8]/60">
            Turn leads into customers without hiring a salesperson — research,
            outreach and follow-ups in one workspace.
          </p>
        </div>
        <p className="text-xs text-[#F5F1E8]/40">
          Free plan available · No credit card required
        </p>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <img src={logo} alt="DealFlow AI" className="size-7 rounded-md" />
            <span className="text-sm font-semibold tracking-tight">
              DealFlow<span className="text-[#A9E813]"> AI</span>
            </span>
          </Link>

          {step === "signIn" ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight">
                Get started
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your email to log in or sign up.
              </p>
              <form onSubmit={handleEmailSubmit} className="mt-6">
                <label htmlFor="auth-email" className="sr-only">
                  Email address
                </label>
                <div className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="auth-email"
                      name="email"
                      placeholder="name@example.com"
                      type="email"
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    size="icon"
                    disabled={isLoading}
                    aria-label="Continue with email"
                  >
                    {isLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4" />
                    )}
                  </Button>
                </div>
                {error && (
                  <p className="mt-2 text-sm text-destructive">{error}</p>
                )}

                <div className="mt-6">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Or
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 w-full"
                    onClick={handleGuestLogin}
                    disabled={isLoading}
                  >
                    <UserX className="mr-2 size-4" />
                    Continue as guest
                  </Button>
                </div>
              </form>

              <div className="mt-8 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                Guest sessions start with an empty workspace — you can load 8
                sample leads to look around.
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight">
                Check your email
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We've sent a code to {step.email}.
              </p>
              <form onSubmit={handleOtpSubmit} className="mt-6">
                <input type="hidden" name="email" value={step.email} />
                <input type="hidden" name="code" value={otp} />

                <div className="flex justify-center">
                  <InputOTP
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        otp.length === 6 &&
                        !isLoading
                      ) {
                        const form = (e.target as HTMLElement).closest("form");
                        if (form) form.requestSubmit();
                      }
                    }}
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot key={index} index={index} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {error && (
                  <p className="mt-3 text-center text-sm text-destructive">
                    {error}
                  </p>
                )}
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Didn't receive a code?{" "}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => setStep("signIn")}
                  >
                    Try again
                  </Button>
                </p>
                <Button
                  type="submit"
                  className="mt-4 w-full"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    <>
                      Verify code <ArrowRight className="ml-2 size-4" />
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("signIn")}
                  disabled={isLoading}
                  className="mt-2 w-full"
                >
                  Use different email
                </Button>
              </form>
            </>
          )}

          <p className="mt-10 text-center text-xs text-muted-foreground">
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
            >
              freebuff.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
