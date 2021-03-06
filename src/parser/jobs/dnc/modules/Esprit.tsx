import {t} from '@lingui/macro'
import {Plural, Trans} from '@lingui/react'
import Color from 'color'
import _ from 'lodash'
import React, {Fragment} from 'react'

import {ActionLink} from 'components/ui/DbLink'
import TimeLineChart from 'components/ui/TimeLineChart'
import ACTIONS from 'data/ACTIONS'
import JOBS from 'data/JOBS'
import STATUSES from 'data/STATUSES'
import {BuffEvent, DamageEvent} from 'fflogs'
import Module, {dependency} from 'parser/core/Module'
import Combatants from 'parser/core/modules/Combatants'
import Suggestions, {SEVERITY, TieredSuggestion} from 'parser/core/modules/Suggestions'

import styles from './DNCGauges.module.css'

// Dances take more than a GCD to apply, during which time party members will be generating esprit for you
// We'll need to multiply the amount generated by the VERY rough-estimate of how many GCDs passed while you were dancing
const ESPRIT_GENERATION_MULTIPLIERS = {
	[ACTIONS.CASCADE.id]: 1,
	[ACTIONS.REVERSE_CASCADE.id]: 1,
	[ACTIONS.FOUNTAIN.id]: 1,
	[ACTIONS.FOUNTAINFALL.id]: 1,
	[ACTIONS.WINDMILL.id]: 1,
	[ACTIONS.RISING_WINDMILL.id]: 1,
	[ACTIONS.BLADESHOWER.id]: 1,
	[ACTIONS.BLOODSHOWER.id]: 1,
	[ACTIONS.SABER_DANCE.id]: 1,
	[ACTIONS.STANDARD_FINISH.id]: 2,
	[ACTIONS.SINGLE_STANDARD_FINISH.id]: 2,
	[ACTIONS.DOUBLE_STANDARD_FINISH.id]: 2,
	[ACTIONS.TECHNICAL_FINISH.id]: 3,
	[ACTIONS.SINGLE_TECHNICAL_FINISH.id]: 3,
	[ACTIONS.DOUBLE_TECHNICAL_FINISH.id]: 3,
	[ACTIONS.TRIPLE_TECHNICAL_FINISH.id]: 3,
	[ACTIONS.QUADRUPLE_TECHNICAL_FINISH.id]: 3,
}

const STANDARD_FINISHES = [
	ACTIONS.STANDARD_FINISH.id,
	ACTIONS.SINGLE_STANDARD_FINISH.id,
	ACTIONS.DOUBLE_STANDARD_FINISH.id,
]

const TECHNICAL_FINISHES = [
	ACTIONS.TECHNICAL_FINISH.id,
	ACTIONS.SINGLE_TECHNICAL_FINISH.id,
	ACTIONS.DOUBLE_TECHNICAL_FINISH.id,
	ACTIONS.TRIPLE_TECHNICAL_FINISH.id,
	ACTIONS.QUADRUPLE_TECHNICAL_FINISH.id,
]

const FINISHES = [
	...STANDARD_FINISHES,
	...TECHNICAL_FINISHES,
]

const ESPRIT_GENERATION_AMOUNT = 10

const TICK_FREQUENCY = 3000
const MAX_IMPROV_TICKS = 5

const ESPRIT_RATE_SELF = 0.25
const ESPRIT_RATE_PARTY = 0.2

const MAX_ESPRIT = 100
const SABER_DANCE_COST = 50

export default class EspritGauge extends Module {
	static handle = 'espritgauge'
	static title = t('dnc.esprit-gauge.title')`Esprit Gauge`

	@dependency private combatants!: Combatants
	@dependency private suggestions!: Suggestions

	private potentialOvercap = 0
	private espritConsumed = 0
	private avgGenerated = 0
	private history: any[] = []
	private currentEsprit = 0
	private improvisationStart = 0

	protected init() {
		this.addHook('damage', {by: 'player'}, this.onDamage)
		this.addHook('cast', {by: 'player', abilityId: ACTIONS.SABER_DANCE.id}, this.onConsumeEsprit)
		this.addHook('applybuff', {by: 'player', abilityId: STATUSES.IMPROVISATION.id}, this.startImprov)
		this.addHook('removebuff', {by: 'player', abilityId: STATUSES.IMPROVISATION.id}, this.endImprov)
		this.addHook('death', {to: 'player'}, this.onDeath)
		this.addHook('complete', this.onComplete)
	}
	private onDamage(event: DamageEvent) {
		if (!ESPRIT_GENERATION_MULTIPLIERS[event.ability.guid] || event.amount === 0) {
			return
		}
		let generatedAmt = 0
		if (this.combatants.selected.hasStatus(STATUSES.TECHNICAL_FINISH.id)) {
			generatedAmt += ESPRIT_GENERATION_MULTIPLIERS[event.ability.guid] * ESPRIT_GENERATION_AMOUNT * ESPRIT_RATE_PARTY * (Object.keys(this.combatants.getEntities()).length-1)
			// Finishes aren't a weaponskill, so they don't generate esprit
			if (!FINISHES[event.ability.guid]) {
				generatedAmt += ESPRIT_GENERATION_MULTIPLIERS[event.ability.guid] * ESPRIT_GENERATION_AMOUNT * ESPRIT_RATE_SELF
			}
		} else if (this.combatants.selected.hasStatus(STATUSES.ESPRIT.id)) {
			generatedAmt += ESPRIT_GENERATION_MULTIPLIERS[event.ability.guid] * ESPRIT_GENERATION_AMOUNT * ESPRIT_RATE_SELF
			if (this.combatants.selected.hasStatus(STATUSES.CLOSED_POSITION.id)) {
				generatedAmt += ESPRIT_GENERATION_MULTIPLIERS[event.ability.guid] * ESPRIT_GENERATION_AMOUNT * ESPRIT_RATE_PARTY
			}
		}
		this.avgGenerated += generatedAmt
		if (generatedAmt > 0) {
			this.setEsprit(this.currentEsprit + generatedAmt)
		}
	}
	private onConsumeEsprit() {
		this.espritConsumed++
		if (this.currentEsprit < SABER_DANCE_COST) {
			const prevHistory = this.history.pop()
			prevHistory.y = SABER_DANCE_COST
			this.history.push(prevHistory)
		}
		this.setEsprit(this.currentEsprit - SABER_DANCE_COST)
	}
	private onDeath() {
		this.setEsprit(0)
	}
	private setEsprit(value: number) {
		this.currentEsprit = _.clamp(value, 0, MAX_ESPRIT)
		this.potentialOvercap += Math.max(0, value - this.currentEsprit)
		const t = this.parser.currentTimestamp - this.parser.fight.start_time
		this.history.push({t, y: this.currentEsprit})
	}

	private startImprov(event: BuffEvent) {
		this.improvisationStart = event.timestamp
	}

	endImprov(event: BuffEvent) {
		const diff = event.timestamp - this.improvisationStart

		// Ticks could occur at any point in the duration (server tick) - always give at least one tick so we don't under-guess
		const ticks = Math.min(Math.max(1, Math.floor(diff / TICK_FREQUENCY)), MAX_IMPROV_TICKS)

		// Choosing to assume in this case that everyone is in range so you get the maximum amount of Esprit per tic
		this.setEsprit(this.currentEsprit + ticks * ESPRIT_GENERATION_AMOUNT)
	}

	private onComplete() {
		const missedSaberDances = Math.floor(this.potentialOvercap/SABER_DANCE_COST)
		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.SABER_DANCE.icon,
			content: <Trans id="dnc.esprit.suggestions.overcapped-esprit.content">
				You may have lost uses of <ActionLink {...ACTIONS.SABER_DANCE} /> due to overcapping your Esprit gauge. Make sure you use it, especially if your gauge is above 80.
			</Trans>,
			tiers: {
				1: SEVERITY.MINOR,
				5: SEVERITY.MEDIUM,
				10: SEVERITY.MAJOR,
			},
			value: missedSaberDances,
			why: <Trans id="dnc.esprit.suggestions.overcapped-esprit.why">
				<Plural value={missedSaberDances} one="# Saber Dance" other="# Saber Dances"/> may have been missed.
			</Trans>,
		}))
	}

	output() {
		const dncColor = Color(JOBS.DANCER.colour)

		// tslint:disable:no-magic-numbers
		const data = {
			datasets: [{
				label: 'Esprit',
				data: this.history,
				steppedLine: true,
				backgroundColor: dncColor.fade(0.8),
				borderColor: dncColor.fade(0.5),
			}],
		}
		// tslint:enable:no-magic-numbers

		return <Fragment>
			<span className={styles.helpText}>
				<Trans id="dnc.esprit-gauge.graph.help-text">This graph is a rough estimate of your esprit gauge, at best. Take it with a hefty grain of salt.</Trans>
			</span>
			<TimeLineChart data={data} />
		</Fragment>
	}
}
