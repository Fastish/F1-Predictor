import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useSEO } from "@/hooks/useSEO";
import {
  Wallet,
  Mail,
  ExternalLink,
  ArrowRight,
  CircleDollarSign,
  ArrowRightLeft,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  CheckCircle2,
  CreditCard,
  Building,
  Coins,
  TrendingUp,
  Flag,
} from "lucide-react";
import { SiCoinbase } from "react-icons/si";
import { Link } from "wouter";

const walletOptions = [
  {
    name: "MetaMask",
    description: "Most popular browser extension wallet",
    url: "https://metamask.io/download/",
    icon: "https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg",
  },
  {
    name: "Rainbow",
    description: "User-friendly mobile wallet with great UX",
    url: "https://rainbow.me/",
    icon: null,
  },
  {
    name: "Coinbase Wallet",
    description: "Backed by Coinbase exchange, easy to use",
    url: "https://www.coinbase.com/wallet",
    icon: null,
  },
];

const onrampOptions = [
  {
    name: "Coinbase",
    description: "Major US exchange with easy bank transfers and card purchases",
    url: "https://www.coinbase.com/",
    features: ["Bank transfer", "Debit card", "Apple Pay"],
  },
  {
    name: "Kraken",
    description: "Established exchange with low fees",
    url: "https://www.kraken.com/",
    features: ["Bank transfer", "Wire transfer"],
  },
  {
    name: "MoonPay",
    description: "Buy crypto directly with card, available in many wallets",
    url: "https://www.moonpay.com/",
    features: ["Credit card", "Debit card", "Apple Pay"],
  },
  {
    name: "Transak",
    description: "Global coverage with multiple payment methods",
    url: "https://transak.com/",
    features: ["Bank transfer", "Card", "Local payments"],
  },
];

const faqItems = [
  {
    question: "What is a prediction market?",
    answer:
      "A prediction market lets you trade on the outcome of future events. In F1 Predict, you can buy shares in teams or drivers you think will win. If your prediction is correct, your shares are worth $1 each. Prices reflect the crowd's collective probability estimate.",
  },
  {
    question: "Why do I need USDC.e instead of regular USDC?",
    answer:
      "F1 Predict uses Polymarket's infrastructure, which operates with USDC.e (bridged USDC) on the Polygon network. This is a technical requirement - both tokens represent the same $1 value, and you can easily swap between them using the built-in conversion tool in the app.",
  },
  {
    question: "What happens if my team wins the championship?",
    answer:
      "If the team you bet on wins the F1 Championship, each share you hold will be worth $1. For example, if you bought 100 shares at $0.30 each ($30 total), you would receive $100 when the season ends - a profit of $70.",
  },
  {
    question: "What if my team doesn't win?",
    answer:
      "If your team doesn't win the championship, your shares become worthless. However, you can sell your shares at any time before the season ends if prices move in your favor, or cut your losses if they don't.",
  },
  {
    question: "What are the different order types?",
    answer:
      "FOK (Fill or Kill) executes immediately at the best available price - use this for quick trades. GTC (Good Till Cancelled) is a limit order that stays open until filled or cancelled - use this to set your desired price. GTD (Good Till Date) is like GTC but expires at a specific date/time.",
  },
  {
    question: "What fees does the platform charge?",
    answer:
      "F1 Predict charges a small percentage fee on trades (typically 2%). This fee is collected after your order is successfully executed. For limit orders (GTC/GTD), fees are only charged when your order actually fills.",
  },
  {
    question: "What is the Safe Trading Wallet?",
    answer:
      "When using an external wallet (MetaMask, Rainbow, etc.), a Safe Trading Wallet is automatically created for you. This is a Gnosis Safe smart contract wallet that enables gasless trading on Polymarket. You can deposit USDC.e directly to your Safe Trading Wallet using its QR code in the wallet management screen, or transfer from your connected wallet.",
  },
  {
    question: "Is my money safe?",
    answer:
      "Your funds are held in your own blockchain wallet, not by F1 Predict. Trades are executed through Polymarket's smart contracts on the Polygon blockchain. However, as with all crypto, you are responsible for keeping your wallet secure and never sharing your private key or seed phrase.",
  },
  {
    question: "How do I withdraw my winnings?",
    answer:
      "Click on your Cash balance in the header and select 'Deposit / Withdraw' to open wallet management. From the Send tab, you can transfer USDC.e to any address. To convert USDC.e to USDC first, use the 'Swap USDC' option. From your external wallet, you can send funds to any crypto exchange (Coinbase, Kraken, etc.) and convert to your local currency.",
  },
  {
    question: "What network does this run on?",
    answer:
      "F1 Predict runs on the Polygon network (formerly Matic), which is a Layer 2 scaling solution for Ethereum. Polygon offers very low transaction fees (fractions of a cent) and fast confirmations. Make sure your wallet is set to the Polygon network when making deposits.",
  },
  {
    question: "Can I use this from any country?",
    answer:
      "F1 Predict is built on decentralized infrastructure, but access may be restricted in certain jurisdictions. Please check your local laws regarding prediction markets and cryptocurrency usage before participating.",
  },
];

export default function HowToUse() {
  useSEO({
    title: "How to Trade F1 Predictions",
    description: "Learn how to bet on Formula 1 outcomes using F1 Predict. Set up a wallet, get USDC on Polygon, and start trading on the 2026 F1 Championship."
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 text-center">
          <h1
            className="text-4xl font-bold tracking-tight"
            data-testid="text-how-to-use-title"
          >
            How to Use F1 Predict
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Your complete guide to getting started with F1 prediction markets
          </p>
        </div>

        <div className="space-y-12">
          <section id="step-1-wallet">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                1
              </div>
              <h2 className="text-2xl font-bold">Set Up Your Wallet</h2>
            </div>

            <Card>
              <CardContent className="pt-6">
                <p className="mb-6 text-muted-foreground">
                  You need a crypto wallet to trade on F1 Predict. You have two
                  options:
                </p>

                <div className="grid gap-6 md:grid-cols-2">
                  <Card className="border-primary/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Mail className="h-5 w-5 text-primary" />
                        Email Login (Easiest)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">
                        Sign in with your email address and we'll create a
                        secure wallet for you automatically using Magic Link
                        technology. No downloads required.
                      </p>
                      <Badge variant="secondary">Recommended for beginners</Badge>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Wallet className="h-5 w-5" />
                        External Wallet
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">
                        Connect your existing crypto wallet. Great if you
                        already have one or want full control over your funds.
                      </p>
                      <Badge variant="outline">For experienced users</Badge>
                    </CardContent>
                  </Card>
                </div>

                <div className="mt-8">
                  <h3 className="font-semibold mb-4">Popular External Wallets</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    {walletOptions.map((wallet, index) => (
                      <a
                        key={wallet.name}
                        href={wallet.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        data-testid={`link-wallet-${wallet.name.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        <Card className="hover-elevate h-full">
                          <CardContent className="flex items-center gap-3 pt-4 pb-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                              <Wallet className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium">{wallet.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {wallet.description}
                              </p>
                            </div>
                            <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          </CardContent>
                        </Card>
                      </a>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="step-2-fund">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                2
              </div>
              <h2 className="text-2xl font-bold">Fund Your Wallet</h2>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-start gap-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-600 dark:text-amber-400">
                      Important: Use the Polygon Network
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      F1 Predict runs on Polygon, not Ethereum mainnet. Always
                      select "Polygon" when sending funds. Sending to the wrong
                      network may result in lost funds.
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Onramp Options (Fiat to Crypto)
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Convert your regular currency (USD, EUR, etc.) to USDC on
                    Polygon:
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {onrampOptions.map((option, index) => (
                      <a
                        key={option.name}
                        href={option.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        data-testid={`link-onramp-${option.name.toLowerCase()}`}
                      >
                        <Card className="hover-elevate h-full">
                          <CardContent className="pt-4 pb-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-medium">{option.name}</p>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">
                              {option.description}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {option.features.map((feature) => (
                                <Badge
                                  key={feature}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {feature}
                                </Badge>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </a>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    Already Have Crypto?
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>From an exchange:</strong> Withdraw USDC to your
                        wallet address on the Polygon network
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>From another wallet:</strong> Send USDC on
                        Polygon to your F1 Predict wallet address
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>On Ethereum?</strong> Use a bridge like{" "}
                        <a
                          href="https://portal.polygon.technology/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                          data-testid="link-polygon-bridge"
                        >
                          Polygon Bridge
                        </a>{" "}
                        to move funds to Polygon
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="step-3-convert">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                3
              </div>
              <h2 className="text-2xl font-bold">Convert to USDC.e</h2>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-center gap-6 p-6 rounded-lg bg-muted/50">
                  <div className="text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-2">
                      <CircleDollarSign className="h-8 w-8 text-primary" />
                    </div>
                    <p className="font-semibold">USDC</p>
                    <p className="text-xs text-muted-foreground">Native USDC</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-2">
                      <Coins className="h-8 w-8 text-primary" />
                    </div>
                    <p className="font-semibold">USDC.e</p>
                    <p className="text-xs text-muted-foreground">
                      Bridged USDC
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Why USDC.e?</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    F1 Predict is powered by Polymarket, which uses USDC.e
                    (bridged USDC) for all trades. Both USDC and USDC.e are
                    worth exactly $1, but you need USDC.e to place orders.
                  </p>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold">How to Convert (Built-in)</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Badge
                        variant="outline"
                        className="rounded-full h-6 w-6 flex items-center justify-center p-0"
                      >
                        1
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        Click on your <strong>Cash balance</strong> in the
                        header to open the Cash menu
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge
                        variant="outline"
                        className="rounded-full h-6 w-6 flex items-center justify-center p-0"
                      >
                        2
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        Select <strong>Swap USDC</strong> to open the swap tool
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge
                        variant="outline"
                        className="rounded-full h-6 w-6 flex items-center justify-center p-0"
                      >
                        3
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        Choose your <strong>wallet source</strong> (Connected Wallet or Safe Trading Wallet) and swap direction
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge
                        variant="outline"
                        className="rounded-full h-6 w-6 flex items-center justify-center p-0"
                      >
                        4
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        Enter the amount and confirm the swap
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Zero Slippage Swap</p>
                      <p className="text-sm text-muted-foreground">
                        Our built-in swap uses 0x Protocol for the best rates
                        with minimal fees. 1 USDC always equals 1 USDC.e.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="step-4-trade">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                4
              </div>
              <h2 className="text-2xl font-bold">Start Trading</h2>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-6">
                <p className="text-muted-foreground">
                  Now you're ready to predict F1 outcomes! Here's what you can
                  bet on:
                </p>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-3 mb-3">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        <p className="font-semibold">Championship Markets</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Bet on which team or driver will win the 2026 World
                        Championship. Prices reflect probability - if a team is
                        at $0.20, the market thinks they have a 20% chance.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-3 mb-3">
                        <Flag className="h-5 w-5 text-primary" />
                        <p className="font-semibold">Race Markets</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Bet on individual race outcomes - who will win, get
                        pole position, or finish on the podium. Each race has
                        its own markets powered by Polymarket.
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Trading Tips</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>Use limit orders</strong> for better prices.
                        Set your desired price and wait for the market to come
                        to you.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>Watch the odds</strong> change as news breaks.
                        Driver transfers, team upgrades, and race results all
                        affect prices.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>Sell early</strong> if you want to lock in
                        profits. You don't have to wait for the season to end.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center pt-4">
                  <Link href="/">
                    <Button size="lg" data-testid="button-start-trading-now">
                      Start Trading Now
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="step-5-withdraw">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                5
              </div>
              <h2 className="text-2xl font-bold">Withdraw Your Winnings</h2>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-6">
                <p className="text-muted-foreground">
                  Ready to cash out? Here's how to convert your winnings back
                  to regular currency:
                </p>

                <div className="space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                    <Badge
                      variant="outline"
                      className="rounded-full h-8 w-8 flex items-center justify-center p-0 flex-shrink-0"
                    >
                      1
                    </Badge>
                    <div>
                      <p className="font-medium">Convert USDC.e back to USDC</p>
                      <p className="text-sm text-muted-foreground">
                        Click your Cash balance and select "Withdraw Cash" to
                        swap USDC.e back to regular USDC.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                    <Badge
                      variant="outline"
                      className="rounded-full h-8 w-8 flex items-center justify-center p-0 flex-shrink-0"
                    >
                      2
                    </Badge>
                    <div>
                      <p className="font-medium">Send USDC to an exchange</p>
                      <p className="text-sm text-muted-foreground">
                        Use "Send / Receive" from the wallet menu to send USDC
                        to Coinbase, Kraken, or your preferred exchange.
                        Remember to use the Polygon network!
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                    <Badge
                      variant="outline"
                      className="rounded-full h-8 w-8 flex items-center justify-center p-0 flex-shrink-0"
                    >
                      3
                    </Badge>
                    <div>
                      <p className="font-medium">Convert to local currency</p>
                      <p className="text-sm text-muted-foreground">
                        Sell your USDC on the exchange and withdraw to your
                        bank account. Most exchanges support direct bank
                        transfers.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="faq">
            <div className="mb-6 flex items-center gap-3">
              <HelpCircle className="h-10 w-10 text-primary" />
              <h2 className="text-2xl font-bold">Frequently Asked Questions</h2>
            </div>

            <Card>
              <CardContent className="pt-6">
                <Accordion type="single" collapsible className="w-full">
                  {faqItems.map((item, index) => (
                    <AccordionItem key={index} value={`item-${index}`}>
                      <AccordionTrigger
                        className="text-left"
                        data-testid={`faq-question-${index}`}
                      >
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </section>
        </div>

        <div className="mt-12 text-center">
          <p className="text-muted-foreground mb-4">
            Still have questions? Check out the{" "}
            <a
              href="https://polymarket.com/learn"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
              data-testid="link-polymarket-learn"
            >
              Polymarket Learn Center
            </a>{" "}
            or{" "}
            <a
              href="https://polygon.technology/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
              data-testid="link-polygon-docs"
            >
              Polygon documentation
            </a>
            .
          </p>
          <Link href="/">
            <Button variant="outline" data-testid="button-back-home">
              Back to Home
            </Button>
          </Link>
        </div>
      </div>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
          <p>F1 Predict - Predictive Market Platform</p>
          <p className="mt-1">This site is powered by Polymarket.com</p>
          <p className="mt-1">
            All orders are subject to{" "}
            <a href="https://polymarket.com/tos" className="underline" data-testid="link-polymarket-tos">
              Polymarket terms
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
