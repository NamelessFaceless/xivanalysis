import CoreCooldowns from 'parser/core/modules/Cooldowns'
import ACTIONS from 'data/ACTIONS'

export default class Cooldowns extends CoreCooldowns {
	static cooldownOrder = [
		{
			name: 'Fists',
			merge: true,
			actions: [
				ACTIONS.FISTS_OF_FIRE.id,
				ACTIONS.FISTS_OF_WIND.id,
				ACTIONS.FISTS_OF_EARTH.id,
			],
		},
		ACTIONS.RIDDLE_OF_FIRE.id,
		ACTIONS.BROTHERHOOD.id,
		ACTIONS.THE_FORBIDDEN_CHAKRA.id,
		ACTIONS.ELIXIR_FIELD.id,
		ACTIONS.TORNADO_KICK.id,
		ACTIONS.PERFECT_BALANCE.id,
		ACTIONS.RIDDLE_OF_EARTH.id,
		ACTIONS.MANTRA.id,
	]
}
