import type {EpisodeCard,EpisodeSource} from '../../body/episode-map';
// Exact worker b240ccbb-6f4d-42be-9613-9322cec0eaca output, not parent paraphrases.
export const episodeCards:EpisodeCard[]=[
{id:'1',title:'Client-record backup restrictions',summary:'Source A specified encrypted offline copies rather than cloud backups for client records because of contractual restrictions.',sources:['A']},
{id:'2',title:'Project deployment schedule correction',summary:'B initially scheduled Cedar for Friday and Birch for Monday. G corrected Cedar to Tuesday, not Friday, and confirmed Birch remained Monday.',sources:['B','G']},
{id:'3',title:'Support mailbox replacement',summary:'The support mailbox old@example.invalid was replaced by help@example.invalid.',sources:['C']},
{id:'4',title:'GPU purchase postponement',summary:'The GPU purchase was postponed because of cost, explicitly not power consumption.',sources:['D']},
{id:'5',title:'Incumbent platform retained',summary:'The team chose to stay on the incumbent platform after the vendor withdrew its warranty. No reason for staying was stated.',sources:['F']},
];
export const episodeSources:EpisodeSource[]=[
{id:'A',text:'Do not use cloud backups for client records; keep encrypted offline copies because of contractual restrictions.'},
{id:'B',text:'Project Cedar deploys on Friday. Project Birch deploys on Monday.'},
{id:'C',text:'Our old support mailbox was old@example.invalid; it was replaced by help@example.invalid.'},
{id:'D',text:'We postponed GPU purchase because of cost, not power consumption.'},
{id:'F',text:'We chose to stay on the incumbent platform after the vendor withdrew its warranty.'},
{id:'G',text:'Correction to B: Cedar now deploys Tuesday, not Friday. Birch remains Monday.'},
];
