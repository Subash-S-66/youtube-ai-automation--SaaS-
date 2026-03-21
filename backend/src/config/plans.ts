import Plan from '../models/Plan';

export type PlanType = 'free' | 'basic' | 'pro' | 'premium' | string;

export const defaultPlans = [
  {
    name: 'free',
    price: 0,
    priority_weight: 10,
    is_active: true,
    features: {
      voice_selection: false,
      scheduling: false,
      multi_channel: false,
    },
    limits: {
      max_channels: 1,
      daily_upload_limit: 2,
    },
  },
  {
    name: 'basic',
    price: 9.99,
    priority_weight: 20,
    is_active: true,
    features: {
      voice_selection: true,
      scheduling: false,
      multi_channel: false,
    },
    limits: {
      max_channels: 2,
      daily_upload_limit: 10,
    },
  },
  {
    name: 'pro',
    price: 29.99,
    priority_weight: 50,
    is_active: true,
    features: {
      voice_selection: true,
      scheduling: true,
      multi_channel: true,
    },
    limits: {
      max_channels: 5,
      daily_upload_limit: 25,
    },
  },
  {
    name: 'premium',
    price: 99.99,
    priority_weight: 100,
    is_active: true,
    features: {
      voice_selection: true,
      scheduling: true,
      multi_channel: true,
    },
    limits: {
      max_channels: 20,
      daily_upload_limit: 100,
    },
  },
];

export const ensureDefaultPlans = async () => {
  for (const planData of defaultPlans) {
    const existing = await Plan.findOne({ name: planData.name });
    if (!existing) {
      await Plan.create(planData);
      console.log(`Created default plan: ${planData.name}`);
    }
  }
};
