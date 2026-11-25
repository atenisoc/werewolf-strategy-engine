import type { RoleId } from '../../game/types';
import type { RoleStrategy } from '../types';
import { hunter } from './hunter';
import { madman } from './madman';
import { mason } from './mason';
import { fox } from './fox';
import { medium } from './medium';
import { seer } from './seer';
import { villager } from './villager';
import { werewolf } from './werewolf';

// 役職を追加するときは、ここに戦略を登録するだけ。
export const STRATEGIES: Record<RoleId, RoleStrategy> = { villager, werewolf, seer, medium, hunter, madman, mason, fox };
