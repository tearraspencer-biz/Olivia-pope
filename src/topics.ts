export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export const medicareTopics: string[] = [
  // FOUNDATIONAL — Week 1
  'What is Medicare and who is eligible — basics for someone turning 65',
  'Medicare Part A hospital coverage — what it covers, costs, and deductibles in 2026',
  'Medicare Part B medical coverage — what it covers, premiums, and enrollment rules in 2026',
  'Medicare Part C Medicare Advantage — how it works and how it differs from Original Medicare',
  'Medicare Part D prescription drug coverage — how it works and how to choose a plan',
  // ENROLLMENT — Week 2
  'Medicare Initial Enrollment Period — the 7-month window and what happens if you miss it',
  'Medicare Special Enrollment Periods — when and how people can enroll outside normal windows',
  'Medicare General Enrollment Period — what it is and the penalties for late enrollment',
  'How Medicare coordinates with employer coverage — rules for people still working at 65',
  'Medicare and COBRA — how they interact and what clients need to know',
  // MEDICARE ADVANTAGE — Week 3
  'Medicare Advantage HMO vs PPO plans — key differences clients need to understand',
  'Medicare Advantage Extra Benefits — dental, vision, hearing, and fitness benefits in 2026',
  'Medicare Advantage network restrictions — why this matters for clients with existing doctors',
  'Medicare Advantage Star Ratings — what they mean and how to use them to evaluate plans',
  'Medicare Advantage Annual Enrollment Period — dates, rules, and how to help clients switch',
  // SUPPLEMENT — Week 4
  'Medicare Supplement Medigap plans — what they are and how they fill Original Medicare gaps',
  'Medigap Plan G vs Plan N — the two most popular plans and how to compare them',
  'Medigap underwriting and guaranteed issue — when clients can and cannot be denied',
  'Medigap vs Medicare Advantage — how to help clients choose the right path',
  'Medicare Supplement premium trends in Tennessee — what clients are paying in 2026',
  // PART D AND PRESCRIPTIONS — Week 5
  'How Medicare Part D formularies work — tiers, restrictions, and exceptions',
  'Medicare Part D coverage gap — what it is in 2026 and how the IRA changed it',
  'Low Income Subsidy Extra Help program — who qualifies and how it reduces drug costs',
  'Medicare and specialty drugs — what clients need to know about high-cost medications',
  'How to compare Part D plans in Tennessee — tools, tips, and what to look for',
  // DUAL ELIGIBLES AND SPECIAL POPULATIONS — Week 6
  'Dual eligible beneficiaries — people who qualify for both Medicare and Medicaid',
  'Medicare Savings Programs in Tennessee — how they reduce costs for low-income clients',
  'Medicare and disability — how people under 65 qualify for Medicare',
  'Medicare for end-stage renal disease — eligibility rules and coverage details',
  'Medicare and ALS — automatic enrollment rules for people diagnosed with ALS',
  // ADVANCED AND BUSINESS-FOCUSED — Week 7
  'How independent agents sell Medicare — licensing, certification, and compliance basics',
  'Medicare commission structure for agents — how compensation works in 2026',
  'CMS marketing rules for Medicare agents — what agents can and cannot do',
  'How to build a Medicare referral network — strategies for independent agents',
  'Medicare sales conversations — common objections and how to handle them',
  // MARKET AND TRENDS — Week 8
  'Medicare Advantage enrollment trends in Tennessee — 2026 data and market share',
  'Medicare Advantage carrier options in Chattanooga — who is competing and how',
  'Original Medicare enrollment trends — who is choosing it over Medicare Advantage and why',
  'CMS policy changes affecting Medicare in 2026 — what agents need to know',
  'Medicare market opportunities for health insurance agents in small markets like Chattanooga',
]

export const rotatingTopics: Record<
  DayOfWeek,
  { category: string; prompts: string[] }
> = {
  monday: {
    category: 'ICHRA',
    prompts: [
      'ICHRA employer eligibility rules — which employers can offer ICHRA in 2026',
      'ICHRA affordability rules and how they affect employee ACA marketplace eligibility',
      'ICHRA vs QSEHRA — key differences and when to recommend each to a small business client',
      'How ICHRA interacts with the ACA marketplace — what employees need to know',
      'ICHRA setup process for a small business — steps, timeline, and what agents do',
      'Common employer objections to ICHRA and how to address them',
      'ICHRA adoption data for small businesses — how many employers are using it in 2026',
      'ICHRA and employee choice — how employees select individual coverage under ICHRA',
      'ICHRA reimbursement limits in 2026 — current IRS limits and how they are set',
      'How to position ICHRA against traditional group insurance in a sales conversation',
    ],
  },
  tuesday: {
    category: 'Market Research',
    prompts: [
      'ACA marketplace premium trends for 2026 — what individual and family plans cost in Tennessee',
      'ACA marketplace enrollment statistics for 2025 — how many people enrolled nationally and in Tennessee',
      'ACA plan availability in Chattanooga Tennessee — carriers, tiers, and options in 2026',
      'Uninsured rate trends in Tennessee — who is still uninsured and why',
      'Small business health coverage trends — how many small businesses offer coverage in 2026',
      'ACA subsidy changes and their impact on enrollment — what the IRA did to premiums',
      'Health insurance affordability trends — what Americans are paying out of pocket in 2026',
      'ACA marketplace carrier exits and entries — which insurers are in or out in Tennessee',
      'Short-term health plan trends — are they growing or shrinking in 2026',
      'Individual health insurance market trends — what is changing for solo buyers in 2026',
    ],
  },
  wednesday: {
    category: 'Competitor Intel',
    prompts: [
      'How are independent health insurance agents using AI to grow their book of business in 2026',
      'What CRM tools are health insurance agents using in 2026 — top platforms and why',
      'How are health insurance agencies marketing themselves online in 2026',
      'What are the most common lead generation strategies for independent health insurance agents',
      'How are agents using video content to attract health insurance clients',
      'What are the top health insurance FMOs and what services do they offer agents',
      'How are insurance agents building referral networks with small business owners',
      'What automation tools are health insurance agents using to reduce manual work',
      'How are agents specializing in ICHRA building their practice — strategies and positioning',
      'What are clients saying they want from their health insurance agent in 2026',
    ],
  },
  thursday: {
    category: 'Content Strategy',
    prompts: [
      'What are the most common health insurance questions people search for online in 2026',
      'What questions do small business owners have about providing health insurance to employees',
      'What do people turning 65 want to know about Medicare — top concerns and confusion points',
      'What health insurance content performs best on social media for insurance agents',
      'What email content topics get the highest open rates in the health insurance industry',
      'What do ICHRA prospects want to know before saying yes — top questions and objections',
      'What health insurance educational content is missing from the market — gaps agents can fill',
      'How do people describe their health insurance confusion — language they use online',
      'What YouTube content about health insurance gets the most views — top topics',
      'What are the biggest misconceptions people have about health insurance in 2026',
    ],
  },
  friday: {
    category: 'AI & Tech',
    prompts: [
      'New AI tools for small business owners released in 2026 — what is available and what matters',
      'How are small business owners using AI to reduce manual work in 2026',
      'AI automation tools specifically for insurance agents — what exists and what works',
      'What AI agent frameworks are being used to build business automation systems in 2026',
      'How are entrepreneurs building AI-powered internal tools without hiring developers',
      'What is changing in the AI tools landscape monthly — key developments in early 2026',
      'How are coaches, consultants, and service providers using AI to scale their business',
      'What AI productivity tools are getting the most traction with small business owners',
      'AI and customer communication — how businesses are using AI to follow up and stay in touch',
      'What small business owners wish AI tools could do — gaps in the current market',
    ],
  },
  saturday: {
    category: 'Health Insurance',
    prompts: [
      'How individual health insurance underwriting works — what factors affect eligibility and price',
      'Health insurance deductibles vs out-of-pocket maximums — what clients confuse most',
      'In-network vs out-of-network coverage — how to explain this clearly to clients',
      'Health insurance Special Enrollment Periods — qualifying life events and how they work',
      'HSA-eligible health plans — what makes a plan HSA-compatible and who benefits',
      'Preventive care coverage under the ACA — what is covered at no cost in 2026',
      'Health insurance for self-employed individuals — best options and strategies in 2026',
      'Short-term health insurance — when it makes sense and when it does not',
      'How to compare health insurance plans — what metrics actually matter for clients',
      'Health insurance renewal season — what clients need to do and when in Tennessee',
    ],
  },
  sunday: {
    category: 'Business Operations',
    prompts: [
      'How independent insurance agents are structuring their business operations in 2026',
      'Client follow-up systems for insurance agents — what works and what does not',
      'How to build a referral engine as an independent health insurance agent',
      'Business systems and tools that reduce chaos for solo operators in 2026',
      'How health insurance agents are building recurring revenue — beyond commissions',
      'Content marketing strategies that generate insurance leads without paid advertising',
      'How to position yourself as an authority in health insurance in a local market',
      'Business operations mistakes independent agents make and how to fix them',
      'How to productize advisory services as a health insurance agent',
      'Growth strategies for independent health insurance agencies — what is working in 2026',
    ],
  },
}

export const dayFocusLabels: Record<DayOfWeek, string> = {
  monday:    'ICHRA INTELLIGENCE',
  tuesday:   'MARKET INTELLIGENCE',
  wednesday: 'COMPETITOR WATCH',
  thursday:  'CONTENT INTELLIGENCE',
  friday:    'AI & TECH INTELLIGENCE',
  saturday:  'HEALTH INSURANCE DEEP DIVE',
  sunday:    'BUSINESS & GROWTH INTELLIGENCE',
}
